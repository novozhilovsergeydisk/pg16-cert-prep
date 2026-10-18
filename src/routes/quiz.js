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
const { createTrainingBatch, getTrainingBatches, getTrainingBatch } = require('../controllers/trainingController');
const { createOptionCheckBatch, postOptionCheck } = require('../controllers/optionCheckController');

const router = express.Router();

// Все запросы тренажёра — только после входа.
router.use(requireAuth);
router.get('/categories', getCategories);
router.get('/questions', getQuestions);
router.post('/training/batches', answerLimit, createTrainingBatch);
router.get('/training/batches', getTrainingBatches);
router.get('/training/batches/:id', getTrainingBatch);
router.post('/answers', answerLimit, postAnswer);
router.post('/option-checks/batches', answerLimit, createOptionCheckBatch);
router.post('/option-checks', answerLimit, postOptionCheck);
router.get('/exam', getExam);
router.post('/exam/check', examCheckLimit, postExamCheck);
router.get('/mistakes', getMistakes);
router.get('/exam/history', getExamHistory);

module.exports = router;
