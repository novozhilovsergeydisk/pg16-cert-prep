const express = require('express');
const { getMyStats, getAdminUsers, getAdminUser, getHardQuestions } = require('../controllers/statsController');
const { requireAuth, requireAdmin } = require('../middleware/auth');

const router = express.Router();

router.get('/stats', requireAuth, getMyStats);
router.get('/admin/users', requireAuth, requireAdmin, getAdminUsers);
router.get('/admin/users/:id', requireAuth, requireAdmin, getAdminUser);
router.get('/admin/hard-questions', requireAuth, requireAdmin, getHardQuestions);

module.exports = router;
