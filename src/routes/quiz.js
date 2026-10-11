const express = require('express');
const {
    getCategories,
    getQuestions,
    postAnswer,
    getExam,
    postExamCheck,
    getMistakes,
    getExamHistory,
} = require('../controllers/quizController');
const { requireAuth } = require('../middleware/auth');
const { answerLimit, examCheckLimit } = require('../middleware/rateLimit');

const router = express.Router();

// Все запросы тренажёра — только после входа.
router.use(requireAuth);
router.get('/categories', getCategories);
router.get('/questions', getQuestions);
router.post('/answers', answerLimit, postAnswer);
router.get('/exam', getExam);
router.post('/exam/check', examCheckLimit, postExamCheck);
router.get('/mistakes', getMistakes);
router.get('/exam/history', getExamHistory);

module.exports = router;
