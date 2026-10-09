const express = require('express');
const { getCategories, getQuestions, postAnswer } = require('../controllers/quizController');

const router = express.Router();

router.get('/categories', getCategories);
router.get('/questions', getQuestions);
router.post('/answers', postAnswer);

module.exports = router;
