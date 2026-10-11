const express = require('express');
const { requestLink, verifyLink, verifyCode, logout, getMe } = require('../controllers/authController');
const { requireAuth } = require('../middleware/auth');
const { linkRequestLimit, codeCheckLimit } = require('../middleware/rateLimit');

const router = express.Router();

router.post('/auth/request', linkRequestLimit, requestLink);
router.post('/auth/verify', verifyLink);
router.post('/auth/verify-code', codeCheckLimit, verifyCode);
router.post('/auth/logout', logout);
router.get('/me', requireAuth, getMe);

module.exports = router;
