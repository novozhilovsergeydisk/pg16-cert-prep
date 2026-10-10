const express = require('express');
const { requestLink, verifyLink, verifyCode, logout, getMe } = require('../controllers/authController');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

router.post('/auth/request', requestLink);
router.post('/auth/verify', verifyLink);
router.post('/auth/verify-code', verifyCode);
router.post('/auth/logout', logout);
router.get('/me', requireAuth, getMe);

module.exports = router;
