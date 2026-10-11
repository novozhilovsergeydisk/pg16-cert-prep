const express = require('express');
const { requestLink, peekLink, verifyLink, verifyCode, logout, getMe } = require('../controllers/authController');
const { requireAuth } = require('../middleware/auth');
const { linkRequestLimit, codeCheckLimit, linkPeekLimit } = require('../middleware/rateLimit');

const router = express.Router();

router.post('/auth/request', linkRequestLimit, requestLink);
router.post('/auth/peek', linkPeekLimit, peekLink);
router.post('/auth/verify', verifyLink);
router.post('/auth/verify-code', codeCheckLimit, verifyCode);
router.post('/auth/logout', logout);
router.get('/me', requireAuth, getMe);

module.exports = router;
