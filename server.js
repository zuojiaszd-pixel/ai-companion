const path = require('path');
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { connectDB } = require('./config/db');

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'frontend')));

app.use('/api', require('./routes/chat'));

const PORT = process.env.PORT || 10000;
connectDB();
app.listen(PORT, () => console.log(`🚀 服务已启动，端口 ${PORT}`));