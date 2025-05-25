// ===== server.js - 主伺服器檔案 =====
const express = require('express');
const multer = require('multer');
const sqlite3 = require('sqlite3').verbose();
const XLSX = require('xlsx');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

// 中介軟體設定
app.use(express.json());
app.use(express.static('public'));
app.use('/uploads', express.static('uploads'));

// 檔案上傳設定
const upload = multer({ 
    dest: 'uploads/',
    fileFilter: (req, file, cb) => {
        if (file.originalname.match(/\.(xlsx|xls)$/)) {
            cb(null, true);
        } else {
            cb(new Error('只允許上傳Excel檔案'), false);
        }
    }
});

// 初始化資料庫
const db = new sqlite3.Database('quiz.db');

// 建立資料表
db.serialize(() => {
    // 題目表
    db.run(`CREATE TABLE IF NOT EXISTS questions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        question_number INTEGER,
        year INTEGER,
        semester INTEGER,
        subject TEXT,
        category TEXT,
        content TEXT,
        option_a TEXT,
        option_b TEXT,
        option_c TEXT,
        option_d TEXT,
        correct_answer TEXT,
        explanation TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    // 學生練習記錄表
    db.run(`CREATE TABLE IF NOT EXISTS practice_records (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        student_id TEXT,
        student_name TEXT,
        question_id INTEGER,
        user_answer TEXT,
        correct_answer TEXT,
        is_correct BOOLEAN,
        category TEXT,
        practiced_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (question_id) REFERENCES questions (id)
    )`);

    // 學生統計表
    db.run(`CREATE TABLE IF NOT EXISTS student_stats (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        student_id TEXT UNIQUE,
        student_name TEXT,
        total_questions INTEGER DEFAULT 0,
        correct_answers INTEGER DEFAULT 0,
        accuracy_rate REAL DEFAULT 0,
        last_practice DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);
});

// ===== API 路由 =====

// 上傳Excel並匯入題庫
app.post('/api/upload-excel', upload.single('excel'), (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: '請上傳Excel檔案' });
    }

    try {
        const workbook = XLSX.readFile(req.file.path);
        const worksheet = workbook.Sheets[workbook.SheetNames[0]];
        const jsonData = XLSX.utils.sheet_to_json(worksheet);

        // 清空舊資料
        db.run('DELETE FROM questions', (err) => {
            if (err) {
                return res.status(500).json({ error: '清空舊資料失敗' });
            }

            // 插入新資料
            const stmt = db.prepare(`INSERT INTO questions (
                question_number, year, semester, subject, category, content,
                option_a, option_b, option_c, option_d, correct_answer
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);

            let successCount = 0;
            jsonData.forEach((row) => {
                stmt.run([
                    row.題號 || row['題號'],
                    row.年份 || row['年份'],
                    row.學期 || row['學期'],
                    row.科目 || row['科目'],
                    row.主題分類 || row['主題分類'],
                    row.題目內容 || row['題目內容'],
                    row.選項A || row['選項A'],
                    row.選項B || row['選項B'],
                    row.選項C || row['選項C'],
                    row.選項D || row['選項D'],
                    row.正確答案 || row['正確答案']
                ], function(err) {
                    if (!err) successCount++;
                });
            });

            stmt.finalize(() => {
                // 刪除上傳的檔案
                fs.unlinkSync(req.file.path);
                
                res.json({ 
                    message: `成功匯入 ${successCount} 題到資料庫`,
                    count: successCount 
                });
            });
        });

    } catch (error) {
        console.error('Excel處理錯誤:', error);
        res.status(500).json({ error: 'Excel檔案處理失敗' });
    }
});

// 獲取題庫統計
app.get('/api/stats', (req, res) => {
    db.all(`
        SELECT 
            COUNT(*) as total_questions,
            category,
            COUNT(*) as count
        FROM questions 
        GROUP BY category
    `, [], (err, categories) => {
        if (err) {
            return res.status(500).json({ error: '獲取統計失敗' });
        }

        db.get('SELECT COUNT(*) as total FROM questions', [], (err, total) => {
            if (err) {
                return res.status(500).json({ error: '獲取總數失敗' });
            }

            res.json({
                totalQuestions: total.total,
                categories: categories
            });
        });
    });
});

// 開始練習 - 獲取題目
app.post('/api/start-practice', (req, res) => {
    const { studentId, studentName, category, mode, count } = req.body;

    let query = 'SELECT * FROM questions';
    let params = [];

    if (category && category !== 'all') {
        query += ' WHERE category = ?';
        params.push(category);
    }

    if (mode === 'random') {
        query += ' ORDER BY RANDOM()';
    }

    if (count && count > 0) {
        query += ' LIMIT ?';
        params.push(count);
    }

    db.all(query, params, (err, questions) => {
        if (err) {
            return res.status(500).json({ error: '獲取題目失敗' });
        }

        // 更新或建立學生記錄
        db.run(`INSERT OR REPLACE INTO student_stats (
            student_id, student_name, total_questions, correct_answers, accuracy_rate
        ) VALUES (?, ?, 
            COALESCE((SELECT total_questions FROM student_stats WHERE student_id = ?), 0),
            COALESCE((SELECT correct_answers FROM student_stats WHERE student_id = ?), 0),
            COALESCE((SELECT accuracy_rate FROM student_stats WHERE student_id = ?), 0)
        )`, [studentId, studentName, studentId, studentId, studentId]);

        res.json({ questions });
    });
});

// 提交答案
app.post('/api/submit-answer', (req, res) => {
    const { studentId, studentName, questionId, userAnswer, category } = req.body;

    // 獲取正確答案
    db.get('SELECT correct_answer FROM questions WHERE id = ?', [questionId], (err, question) => {
        if (err || !question) {
            return res.status(500).json({ error: '獲取題目失敗' });
        }

        const isCorrect = userAnswer === question.correct_answer;

        // 記錄練習結果
        db.run(`INSERT INTO practice_records (
            student_id, student_name, question_id, user_answer, correct_answer, is_correct, category
        ) VALUES (?, ?, ?, ?, ?, ?, ?)`, 
        [studentId, studentName, questionId, userAnswer, question.correct_answer, isCorrect, category],
        function(err) {
            if (err) {
                return res.status(500).json({ error: '記錄答案失敗' });
            }

            // 更新學生統計
            updateStudentStats(studentId, isCorrect);

            res.json({
                correct: isCorrect,
                correctAnswer: question.correct_answer,
                recordId: this.lastID
            });
        });
    });
});

// 獲取學生統計
app.get('/api/student-stats/:studentId', (req, res) => {
    const { studentId } = req.params;

    db.get(`SELECT * FROM student_stats WHERE student_id = ?`, [studentId], (err, stats) => {
        if (err) {
            return res.status(500).json({ error: '獲取統計失敗' });
        }

        // 獲取分類統計
        db.all(`
            SELECT 
                category,
                COUNT(*) as total,
                SUM(CASE WHEN is_correct = 1 THEN 1 ELSE 0 END) as correct,
                ROUND(AVG(CASE WHEN is_correct = 1 THEN 100.0 ELSE 0.0 END), 1) as accuracy
            FROM practice_records 
            WHERE student_id = ? 
            GROUP BY category
        `, [studentId], (err, categoryStats) => {
            if (err) {
                return res.status(500).json({ error: '獲取分類統計失敗' });
            }

            res.json({
                overall: stats || { 
                    student_id: studentId, 
                    total_questions: 0, 
                    correct_answers: 0, 
                    accuracy_rate: 0 
                },
                categories: categoryStats || []
            });
        });
    });
});

// 獲取排行榜
app.get('/api/leaderboard', (req, res) => {
    db.all(`
        SELECT 
            student_name,
            total_questions,
            correct_answers,
            accuracy_rate,
            last_practice
        FROM student_stats 
        WHERE total_questions > 0
        ORDER BY accuracy_rate DESC, total_questions DESC
        LIMIT 20
    `, [], (err, leaderboard) => {
        if (err) {
            return res.status(500).json({ error: '獲取排行榜失敗' });
        }

        res.json({ leaderboard });
    });
});

// 更新學生統計的輔助函數
function updateStudentStats(studentId, isCorrect) {
    db.run(`
        UPDATE student_stats 
        SET 
            total_questions = total_questions + 1,
            correct_answers = correct_answers + ?,
            accuracy_rate = ROUND((correct_answers + ?) * 100.0 / (total_questions + 1), 2),
            last_practice = CURRENT_TIMESTAMP
        WHERE student_id = ?
    `, [isCorrect ? 1 : 0, isCorrect ? 1 : 0, studentId]);
}

// 主頁面路由
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// 管理員頁面
app.get('/admin', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

// 啟動伺服器
app.listen(PORT, () => {
    console.log(`🚀 伺服器運行在 http://localhost:${PORT}`);
    console.log(`📊 管理員頁面: http://localhost:${PORT}/admin`);
});

// 優雅關閉
process.on('SIGINT', () => {
    console.log('正在關閉伺服器...');
    db.close((err) => {
        if (err) {
            console.error('關閉資料庫錯誤:', err.message);
        } else {
            console.log('資料庫連接已關閉');
        }
        process.exit(0);
    });
});