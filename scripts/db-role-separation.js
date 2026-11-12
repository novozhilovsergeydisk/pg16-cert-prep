// Administrative CLI. No credentials, database names, SQL errors or manifests are printed.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');
const { Pool } = require('pg');
const roles = require('./lib/db-role-separation');
process.env.DOTENV_CONFIG_QUIET = 'true';
let runtimePool;

function options(argv) {
    const [command, ...args] = argv;
    roles.requireState(['prepare', 'apply', 'verify', 'rollback'].includes(command));
    const result = { command, socket: '/var/run/postgresql', user: 'postgres', osUser: 'postgres' };
    const names = { '--state-dir': 'directory', '--admin-socket': 'socket', '--admin-user': 'user', '--admin-os-user': 'osUser', '--pg-bin': 'bin', '--service': 'service' };
    for (let i = 0; i < args.length; i += 2) {
        roles.requireState(names[args[i]] && args[i + 1]);
        result[names[args[i]]] = args[i + 1];
    }
    roles.requireState(path.isAbsolute(result.directory || '') && path.isAbsolute(result.socket));
    roles.requireState(path.isAbsolute(result.bin || ''));
    roles.requireState(!result.service || /^[A-Za-z0-9@_.-]+$/.test(result.service));
    return result;
}

function privateDirectory(directory, create) {
    if (create && !fs.existsSync(directory)) fs.mkdirSync(directory, { mode: 0o700 });
    const s = fs.lstatSync(directory);
    roles.requireState(s.isDirectory() && !s.isSymbolicLink() && !(s.mode & 0o077) && s.uid === process.geteuid());
}
function readState(directory) {
    const file = path.join(directory, 'state.json'), s = fs.lstatSync(file);
    roles.requireState(s.isFile() && !s.isSymbolicLink() && !(s.mode & 0o077) && s.uid === process.geteuid() && s.size < 5000000);
    return JSON.parse(fs.readFileSync(file, 'utf8'));
}
function account(name) {
    const run = flag => {
        const r = spawnSync('/usr/bin/id', [flag, name], { encoding: 'utf8', timeout: 5000 });
        roles.requireState(r.status === 0 && /^\d+\s*$/.test(r.stdout));
        return Number(r.stdout.trim());
    };
    return { uid: run('-u'), gid: run('-g') };
}

async function main(argv) {
    const o = options(argv);
    privateDirectory(o.directory, o.command === 'prepare');
    if (o.service) {
        const r = spawnSync('/bin/systemctl', ['show', o.service, '-p', 'MainPID', '--value'], { encoding: 'utf8', timeout: 5000 });
        roles.requireState(r.status === 0 && /^[1-9][0-9]*\s*$/.test(r.stdout));
        const entries = fs.readFileSync('/proc/' + r.stdout.trim() + '/environ').toString().split('\0');
        for (const entry of entries) {
            const equal = entry.indexOf('=');
            if (equal > 0) process.env[entry.slice(0, equal)] = entry.slice(equal + 1);
        }
    }
    runtimePool = require('../src/config/db');
    const rc = await runtimePool.connect();
    let runtime;
    try { runtime = { ...rc.connectionParameters, name: (await rc.query('SELECT current_user AS name')).rows[0].name }; }
    finally { rc.release(); }
    const adminConfig = { host: o.socket, port: runtime.port, database: runtime.database, user: o.user,
        password: () => { throw Object.assign(new Error('Peer authentication required'), { code: 'EADMINAUTH' }); },
        connectionTimeoutMillis: 3000, statement_timeout: 5000, query_timeout: 6000, max: 1 };
    const adminPool = new Pool(adminConfig);
    const effective = { uid: process.geteuid(), gid: process.getegid() }, peer = account(o.osUser);
    let c, broken = false;
    try {
        // Open the peer-authenticated socket as postgres, then regain access to root-private backups.
        // Existing service credentials and pg_hba.conf are not changed.
        roles.requireState(effective.uid === 0 || effective.uid === peer.uid);
        try {
            if (effective.uid === 0) { process.setegid(peer.gid); process.seteuid(peer.uid); }
            c = await adminPool.connect();
        } finally {
            if (effective.uid === 0) { process.seteuid(effective.uid); process.setegid(effective.gid); }
        }
        const version = (await c.query('SHOW server_version_num')).rows[0].server_version_num;
        roles.requireState(Number(version) >= 160000 && Number(version) < 170000);
        const binary = name => path.join(o.bin, name);
        const dump = path.join(o.directory, 'before.dump');
        const verifyBackup = () => {
            const s = fs.lstatSync(dump);
            roles.requireState(s.isFile() && !s.isSymbolicLink() && !(s.mode & 0o077) && s.uid === effective.uid && s.size > 0);
            const r = spawnSync(binary('pg_restore'), ['--list', dump], { stdio: 'ignore', timeout: 30000 });
            roles.requireState(r.status === 0);
        };
        if (o.command === 'prepare') {
            roles.requireState(!fs.existsSync(path.join(o.directory, 'state.json')) && !fs.existsSync(dump));
            const state = await roles.capture(c, runtime.name);
            // A caller-supplied binary directory avoids pg_wrapper selecting mismatched clients.
            const v = spawnSync(binary('pg_dump'), ['--version'], { encoding: 'utf8', timeout: 5000 });
            roles.requireState(v.status === 0 && /PostgreSQL\) 16\./.test(v.stdout));
            const fd = fs.openSync(dump, 'wx', 0o600);
            try {
                const r = spawnSync(binary('pg_dump'), ['--no-password', '--format=custom', '--compress=0',
                    '-h', o.socket, '-p', String(runtime.port), '-U', o.user, '-d', runtime.database], {
                    env: { PATH: '/usr/bin:/bin', LC_ALL: 'C' }, uid: peer.uid, gid: peer.gid,
                    stdio: ['ignore', fd, 'pipe'], timeout: 120000,
                });
                roles.requireState(r.status === 0);
                fs.fsyncSync(fd);
            } finally { fs.closeSync(fd); }
            verifyBackup();
            fs.writeFileSync(path.join(o.directory, 'state.json'), JSON.stringify(state, null, 2), { flag: 'wx', mode: 0o600 });
            console.log('role_migration prepared');
        } else {
            const state = readState(o.directory);
            verifyBackup();
            roles.requireState(state.runtime === runtime.name && state.database === runtime.database);
            if (o.command === 'apply') console.log('role_migration ' + await roles.apply(c, state));
            else if (o.command === 'rollback') console.log('role_migration ' + await roles.rollback(c, state));
            else {
                await c.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
                try { await roles.verify(c, state); } finally { await c.query('ROLLBACK'); }
                console.log('role_migration verified');
            }
        }
    } catch (e) { broken = !!e.connectionBroken; throw e; }
    finally { c?.release(broken); await adminPool.end(); }
}
if (require.main === module) main(process.argv.slice(2)).catch(err => {
    require('../src/middleware/requestLog').logError('role_migration', err);
    process.exitCode = 1;
}).finally(() => runtimePool?.end());

module.exports = { options };
