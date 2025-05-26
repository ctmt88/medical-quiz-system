// ===== server.js - 醫檢師線上題庫練習系統 =====
const express = require('express');
const multer = require('multer');
const sqlite3 = require('sqlite3').verbose();
const XLSX = require('xlsx');
const path = require('path');
const fs = require('fs');
const session = require('express-session');
const bcrypt = require('bcrypt');

const app = express();
const PORT = process.env.PORT || 3000;

// 中介軟體設定
app.use(express.json());
app.use(express.static('public'));
app.use('/uploads', express.static('uploads'));

// 會話管理設定
app.use(session({
    secret: process.env.SESSION_SECRET || 'medical-quiz-secret-key-2025',
    resave: false,
    saveUninitialized: false,
    cookie: {
        secure: false, // 在HTTPS環境設為true
        maxAge: 24 * 60 * 60 * 1000 // 24小時
    }
}));

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
    // 題目表（包含詳解欄位）
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
        explanation TEXT,           -- 詳解內容
        explanation_image TEXT,     -- 詳解圖片路徑
        difficulty INTEGER DEFAULT 3,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    // 管理員表
    db.run(`CREATE TABLE IF NOT EXISTS admin_users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        email TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        last_login DATETIME
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
        time_spent INTEGER DEFAULT 0,
        viewed_explanation BOOLEAN DEFAULT 0,  -- 是否查看過詳解
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
        total_time_spent INTEGER DEFAULT 0,
        last_practice DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    // 檢查是否已有管理員，如果沒有則創建預設管理員
    db.get("SELECT COUNT(*) as count FROM admin_users", [], (err, row) => {
        if (!err && row.count === 0) {
            // 預設管理員：admin / admin123
            const defaultPassword = 'admin123';
            bcrypt.hash(defaultPassword, 10, (err, hash) => {
                if (!err) {
                    db.run(`INSERT INTO admin_users (username, password_hash, email) 
                            VALUES (?, ?, ?)`, 
                           ['admin', hash, 'admin@medical-quiz.com']);
                    console.log('🔐 已創建預設管理員帳號: admin / admin123');
                }
            });
        }
    });
});

// ===== 認證中介軟體 =====
function requireAuth(req, res, next) {
    if (req.session && req.session.admin) {
        return next();
    } else {
        return res.redirect('/admin/login');
    }
}

// ===== 認證相關路由 =====

// 管理員登入頁面
app.get('/admin/login', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'admin-login.html'));
});

// 管理員登入處理
app.post('/admin/login', async (req, res) => {
    const { username, password } = req.body;

    if (!username || !password) {
        return res.status(400).json({ error: '請輸入用戶名和密碼' });
    }

    db.get("SELECT * FROM admin_users WHERE username = ?", [username], async (err, user) => {
        if (err) {
            return res.status(500).json({ error: '登入失敗' });
        }

        if (!user) {
            return res.status(401).json({ error: '用戶名或密碼錯誤' });
        }

        try {
            const isValidPassword = await bcrypt.compare(password, user.password_hash);
            
            if (isValidPassword) {
                req.session.admin = {
                    id: user.id,
                    username: user.username,
                    email: user.email
                };

                // 更新最後登入時間
                db.run("UPDATE admin_users SET last_login = CURRENT_TIMESTAMP WHERE id = ?", [user.id]);

                res.json({ success: true, message: '登入成功' });
            } else {
                res.status(401).json({ error: '用戶名或密碼錯誤' });
            }
        } catch (error) {
            res.status(500).json({ error: '登入處理失敗' });
        }
    });
});

// 管理員登出
app.post('/admin/logout', (req, res) => {
    req.session.destroy((err) => {
        if (err) {
            return res.status(500).json({ error: '登出失敗' });
        }
        res.json({ success: true, message: '已登出' });
    });
});

// 檢查登入狀態
app.get('/admin/check-auth', (req, res) => {
    if (req.session && req.session.admin) {
        res.json({ authenticated: true, user: req.session.admin });
    } else {
        res.json({ authenticated: false });
    }
});

// 修改密碼API
app.post('/admin/change-password', requireAuth, async (req, res) => {
    const { currentPassword, newPassword, confirmPassword } = req.body;
    const adminId = req.session.admin.id;

    // 驗證輸入
    if (!currentPassword || !newPassword || !confirmPassword) {
        return res.status(400).json({ error: '請填寫所有欄位' });
    }

    if (newPassword !== confirmPassword) {
        return res.status(400).json({ error: '新密碼與確認密碼不符' });
    }

    if (newPassword.length < 6) {
        return res.status(400).json({ error: '新密碼至少需要6個字元' });
    }

    try {
        // 獲取當前用戶資訊
        db.get("SELECT * FROM admin_users WHERE id = ?", [adminId], async (err, user) => {
            if (err || !user) {
                return res.status(500).json({ error: '獲取用戶資訊失敗' });
            }

            // 驗證當前密碼
            const isValidCurrentPassword = await bcrypt.compare(currentPassword, user.password_hash);
            
            if (!isValidCurrentPassword) {
                return res.status(401).json({ error: '當前密碼錯誤' });
            }

            // 加密新密碼
            const newPasswordHash = await bcrypt.hash(newPassword, 10);

            // 更新密碼
            db.run("UPDATE admin_users SET password_hash = ? WHERE id = ?", 
                   [newPasswordHash, adminId], function(err) {
                if (err) {
                    return res.status(500).json({ error: '密碼更新失敗' });
                }

                res.json({ 
                    success: true, 
                    message: '密碼修改成功！請重新登入。' 
                });
            });
        });

    } catch (error) {
        console.error('修改密碼錯誤:', error);
        res.status(500).json({ error: '系統錯誤，請稍後重試' });
    }
});

// 添加管理員API
app.post('/admin/add-admin', requireAuth, async (req, res) => {
    const { username, password, email } = req.body;

    // 驗證輸入
    if (!username || !password) {
        return res.status(400).json({ error: '請填寫用戶名和密碼' });
    }

    if (password.length < 6) {
        return res.status(400).json({ error: '密碼至少需要6個字元' });
    }

    try {
        // 檢查用戶名是否已存在
        db.get("SELECT id FROM admin_users WHERE username = ?", [username], async (err, existingUser) => {
            if (err) {
                return res.status(500).json({ error: '檢查用戶名失敗' });
            }

            if (existingUser) {
                return res.status(400).json({ error: '用戶名已存在' });
            }

            // 加密密碼
            const passwordHash = await bcrypt.hash(password, 10);

            // 添加新管理員
            db.run("INSERT INTO admin_users (username, password_hash, email) VALUES (?, ?, ?)", 
                   [username, passwordHash, email || ''], function(err) {
                if (err) {
                    return res.status(500).json({ error: '添加管理員失敗' });
                }

                res.json({ 
                    success: true, 
                    message: `管理員 ${username} 添加成功！`,
                    adminId: this.lastID
                });
            });
        });

    } catch (error) {
        console.error('添加管理員錯誤:', error);
        res.status(500).json({ error: '系統錯誤，請稍後重試' });
    }
});

// 獲取管理員列表API
app.get('/admin/list-admins', requireAuth, (req, res) => {
    db.all("SELECT id, username, email, created_at, last_login FROM admin_users ORDER BY created_at DESC", 
           [], (err, admins) => {
        if (err) {
            return res.status(500).json({ error: '獲取管理員列表失敗' });
        }

        res.json({ admins });
    });
});

// 刪除管理員API
app.delete('/admin/delete-admin/:id', requireAuth, (req, res) => {
    const adminIdToDelete = parseInt(req.params.id);
    const currentAdminId = req.session.admin.id;

    if (adminIdToDelete === currentAdminId) {
        return res.status(400).json({ error: '無法刪除自己的帳號' });
    }

    // 檢查是否為最後一個管理員
    db.get("SELECT COUNT(*) as count FROM admin_users", [], (err, result) => {
        if (err) {
            return res.status(500).json({ error: '檢查管理員數量失敗' });
        }

        if (result.count <= 1) {
            return res.status(400).json({ error: '至少需要保留一個管理員帳號' });
        }

        // 刪除管理員
        db.run("DELETE FROM admin_users WHERE id = ?", [adminIdToDelete], function(err) {
            if (err) {
                return res.status(500).json({ error: '刪除管理員失敗' });
            }

            if (this.changes === 0) {
                return res.status(404).json({ error: '管理員不存在' });
            }

            res.json({ 
                success: true, 
                message: '管理員刪除成功' 
            });
        });
    });
});

// 管理員主頁面（需要認證）
app.get('/admin', requireAuth, (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

// ===== 題庫管理API =====

// 上傳Excel並匯入題庫（需要認證）
app.post('/api/upload-excel', requireAuth, upload.single('excel'), (req, res) => {
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

            // 插入新資料（包含詳解）
            const stmt = db.prepare(`INSERT INTO questions (
                question_number, year, semester, subject, category, content,
                option_a, option_b, option_c, option_d, correct_answer, explanation
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);

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
                    row.正確答案 || row['正確答案'],
                    row.詳解 || row['詳解'] || '' // 詳解欄位
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

// ===== 學生練習API =====

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

// 提交答案（包含詳解）
app.post('/api/submit-answer', (req, res) => {
    const { studentId, studentName, questionId, userAnswer, category, timeSpent } = req.body;

    // 獲取正確答案和詳解
    db.get('SELECT correct_answer, explanation FROM questions WHERE id = ?', [questionId], (err, question) => {
        if (err || !question) {
            return res.status(500).json({ error: '獲取題目失敗' });
        }

        const isCorrect = userAnswer === question.correct_answer;

        // 記錄練習結果
        db.run(`INSERT INTO practice_records (
            student_id, student_name, question_id, user_answer, correct_answer, 
            is_correct, category, time_spent
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, 
        [studentId, studentName, questionId, userAnswer, question.correct_answer, 
         isCorrect, category, timeSpent || 0],
        function(err) {
            if (err) {
                return res.status(500).json({ error: '記錄答案失敗' });
            }

            // 更新學生統計
            updateStudentStats(studentId, isCorrect);

            res.json({
                correct: isCorrect,
                correctAnswer: question.correct_answer,
                explanation: question.explanation, // 回傳詳解
                recordId: this.lastID
            });
        });
    });
});

// 查看詳解API
app.post('/api/view-explanation', (req, res) => {
    const { studentId, questionId } = req.body;

    // 記錄查看詳解
    db.run(`UPDATE practice_records 
            SET viewed_explanation = 1 
            WHERE student_id = ? AND question_id = ?`, 
           [studentId, questionId], (err) => {
        if (err) {
            console.error('更新詳解查看記錄失敗:', err);
        }
    });

    // 獲取詳解內容
    db.get('SELECT explanation, explanation_image FROM questions WHERE id = ?', 
           [questionId], (err, result) => {
        if (err) {
            return res.status(500).json({ error: '獲取詳解失敗' });
        }

        res.json({
            explanation: result ? result.explanation : '',
            explanationImage: result ? result.explanation_image : null
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

// ===== 路由設定 =====

// 主頁面路由
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// 進階練習頁面
app.get('/advanced', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'advanced.html'));
});

// 啟動伺服器
const listener = app.listen(process.env.PORT, () => {
    console.log(`🚀 伺服器運行在端口 ${listener.address().port}`);
    console.log(`📊 學生練習頁面: http://localhost:${listener.address().port}`);
    console.log(`🔧 進階練習頁面: http://localhost:${listener.address().port}/advanced`);
    console.log(`🔐 管理員登入: http://localhost:${listener.address().port}/admin/login`);
    console.log(`👨‍💼 預設管理員: admin / admin123`);
    console.log(`📚 記得上傳Excel題庫到管理員頁面`);
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
