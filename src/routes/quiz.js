const express = require('express');
const {
    getCategories,
    getQuestions,
    postAnswer,
    getExam,
    postExamCheck,
    getMistakes,
} = require('../controllers/quizController');

const router = express.Router();

router.get('/categories', getCategories);
router.get('/questions', getQuestions);
router.post('/answers', postAnswer);
router.get('/exam', getExam);
router.post('/exam/check', postExamCheck);
router.get('/mistakes', getMistakes);

module.exports = router;
