  "README.md": `# 醫檢師線上題庫練習系統

## 🎯 功能特色

### 👨‍🎓 學生功能
- **個人化登入** - 學號姓名登入，追蹤個人成績
- **多種練習模式** - 隨機出題、順序練習、分類練習
- **即時回饋** - 答題後立即顯示正確答案
- **成績統計** - 個人答題統計、分類表現分析
- **排行榜** - 與其他同學比較學習成果

### 👨‍💼 管理員功能
- **Excel題庫上傳** - 一鍵匯入題庫，自動轉換格式
- **系統統計** - 學生使用情況、題庫分析
- **學生管理** - 查看所有學生的學習記錄
- **資料匯出** - 匯出練習記錄供分析

## 🚀 快速開始

### 本地開發
\`\`\`bash
# 1. 下載專案
git clone <repository-url>
cd medical-quiz-system

# 2. 安裝依賴
npm install

# 3. 初始化
npm run setup

# 4. 啟動開發伺服器
npm run dev
\`\`\`

### 生產部署

#### 選項一：Render.com (推薦)
1. 登入 [Render.com](https://render.com)
2. 連接GitHub儲存庫
3. 選擇 "Web Service"
4. 設定：
   - Build Command: \`npm install\`
   - Start Command: \`npm start\`
   - Node Version: 18

#### 選項二：Railway
1. 登入 [Railway.app](https://railway.app)
2. "New Project" → "Deploy from GitHub repo"
3. 選擇儲存庫，會自動偵測Node.js專案

#### 選項三：Vercel
1. 登入 [Vercel.com](https://vercel.com)
2. 匯入GitHub專案
3. 會自動部署

## 📁 專案結構
\`\`\`
medical-quiz-system/
├── server.js              # 主伺服器檔案
├── package.json           # 專案配置
├── quiz.db               # SQLite資料庫（自動生成）
├── public/               # 靜態檔案
│   ├── index.html        # 學生練習頁面
│   └── admin.html        # 管理員頁面
└── uploads/              # 暫存上傳檔案
\`\`\`

## 🗄️ 資料庫架構

### questions 題目表
- id: 主鍵
- question_number: 題號
- year: 年份
- semester: 學期
- subject: 科目
- category: 主題分類
- content: 題目內容
- option_a/b/c/d: 選項
- correct_answer: 正確答案

### practice_records 練習記錄表
- student_id: 學生學號
- question_id: 題目ID
- user_answer: 學生答案
- is_correct: 是否正確
- practiced_at: 練習時間

### student_stats 學生統計表
- student_id: 學生學號
- total_questions: 總答題數
- correct_answers: 答對數
- accuracy_rate: 正確率

## 📊 Excel格式要求

上傳的Excel檔案需包含以下欄位：
- 題號
- 年份
- 學期  
- 科目
- 主題分類
- 題目內容
- 選項A、選項B、選項C、選項D
- 正確答案

## 🔧 環境變數

\`\`\`bash
PORT=3000                 # 伺服器端口（可選）
NODE_ENV=production       # 生產環境標記
\`\`\`

## 📱 使用說明

### 學生使用流程
1. 開啟系統首頁
2. 輸入學號和姓名登入
3. 選擇練習主題和模式
4. 開始答題練習
5. 查看個人成績統計

### 管理員使用流程
1. 訪問 /admin 管理員頁面
2. 上傳Excel題庫檔案
3. 查看系統使用統計
4. 管理學生資料和記錄

## 🛠️ API 接口

### 題庫管理
- \`POST /api/upload-excel\` - 上傳Excel題庫
- \`GET /api/stats\` - 獲取題庫統計

### 練習功能
- \`POST /api/start-practice\` - 開始練習
- \`POST /api/submit-answer\` - 提交答案
- \`GET /api/student-stats/:id\` - 獲取學生統計

### 系統管理
- \`GET /api/leaderboard\` - 排行榜資料

## 🔒 安全考量

- 無需複雜認證，適合校內使用
- SQLite檔案權限管理
- 檔案上傳類型限制
- 防止SQL注入攻擊

## 🚀 效能優化

- 資料庫索引優化
- 靜態檔案快取
- 壓縮回應資料
- 支援併發訪問

## 📞 技術支援

如有問題，請檢查：
1. Node.js版本 >= 16.0.0
2. 網路連接正常
3. 瀏覽器支援ES6+
4. SQLite寫入權限

## 🎯 未來規劃

- [ ] 圖片題目支援
- [ ] 詳解內容顯示
- [ ] 錯題重做功能
- [ ] 學習進度追蹤
- [ ] 手機App版本
- [ ] 多校區支援

## 📄 授權

MIT License - 可自由使用和修改
`,

  "vercel.json": {
    "version": 2,
    "builds": [
      {
        "src": "server.js",
        "use": "@vercel/node"
      }
    ],
    "routes": [
      {
        "src": "/(.*)",
        "dest": "server.js"
      }
    ]
  },

  "Dockerfile": `
# 使用官方Node.js運行時
FROM node:18-alpine

# 設定工作目錄
WORKDIR /app

# 複製package.json和package-lock.json
COPY package*.json ./

# 安裝依賴
RUN npm ci --only=production

# 複製應用程式源碼
COPY . .

# 建立必要目錄
RUN mkdir -p public uploads

# 暴露端口
EXPOSE 3000

# 設定環境變數
ENV NODE_ENV=production

# 啟動應用程式
CMD ["npm", "start"]
`,

  "docker-compose.yml": `
version: '3.8'

services:
  quiz-app:
    build: .
    ports:
      - "3000:3000"
    volumes:
      - ./quiz.db:/app/quiz.db
      - ./uploads:/app/uploads
    environment:
      - NODE_ENV=production
      - PORT=3000
    restart: unless-stopped
`,
