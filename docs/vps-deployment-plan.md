# VPS 部署方案：从 Render 迁移到腾讯云

## 一、当前架构概览

```
Render (当前宿主)
├── Node.js + Express (server.js, 端口 10000)
├── 前端静态文件 (frontend/index.html)
├── MongoDB (远程，通过 DATABASE_URL 连接)
├── OpenRouter API (AI 对话)
├── Telegram Bot 集成
└── 文件系统：config/status.json 等
```

目标：从 Render 迁移到腾讯云轻量应用服务器（首尔，IP 101.33.76.14），保持所有功能不变。

## 二、服务器环境准备

### 2.1 基础环境

腾讯云服务器：Ubuntu, 2核4G, 59G硬盘, 已配 SSH 公钥

需要安装：
- **Node.js** v18+（推荐 v20 LTS）
- **npm** (随 Node.js 携带)
- **PM2** - 进程管理，保活、自动重启
- **Nginx** - 反向代理，端口映射
- **MongoDB**（可选，见下文存储方案）

### 2.2 存储方案（二选一）

#### 方案 A：继续使用远程 MongoDB（推荐，迁移最快）
- 保持现有 DATABASE_URL 不变
- 无需安装 MongoDB，零数据迁移
- 风险：依赖外部服务，但当前已经在用了

#### 方案 B：MongoDB 本地部署（更自主）
- 在腾讯云上安装 MongoDB
- 需要迁移数据（导出 -> 导入）
- 占用服务器内存（2C4G 跑 MongoDB + Node 有点吃紧）

**推荐方案 A**，先迁移过去跑起来，以后有需要再换。

## 三、部署步骤

### 3.1 服务器初始化

```bash
# 更新系统
apt update && apt upgrade -y

# 安装 Node.js v20
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt install -y nodejs

# 验证
node -v   # 应显示 v20.x
npm -v

# 安装 PM2
npm install -g pm2

# 安装 Nginx
apt install -y nginx
```

### 3.2 部署项目代码

方式一（推荐）：从 GitHub 拉取

```bash
cd /root
git clone https://github.com/zuojiaszd-pixel/ai-companion.git
cd ai-companion
npm install
```

方式二：直接从我当前环境打包传输

```bash
# 在当前 Render 环境打包
tar -czf ai-companion.tar.gz \
  --exclude=node_modules \
  --exclude=.git \
  /opt/render/project/src/

# 然后 scp 到腾讯云
scp ai-companion.tar.gz root@101.33.76.14:/root/
```

### 3.3 配置环境变量

在项目根目录创建 `.env` 文件：

```env
DATABASE_URL=mongodb+srv://...  # 保持现有的 MongoDB 连接串
OPENROUTER_API_KEY=sk-or-v1-...  # 保持现有的 API Key
PORT=10000                        # 内部端口不变
ZHIPUAI_API_KEY=...              # 如果有的话
```

### 3.4 PM2 配置

创建 `ecosystem.config.js`：

```javascript
module.exports = {
  apps: [{
    name: 'ai-companion',
    script: 'server.js',
    env: {
      NODE_ENV: 'production',
    },
    max_memory_restart: '1G',
    log_date_format: 'YYYY-MM-DD HH:mm:ss',
    error_file: 'logs/err.log',
    out_file: 'logs/out.log',
    merge_logs: true,
    autorestart: true,
    watch: false,
    max_restarts: 10,
    restart_delay: 3000,
  }]
};
```

启动：

```bash
pm2 start ecosystem.config.js
pm2 save
pm2 startup   # 开机自启
```

### 3.5 Nginx 反向代理

配置 `/etc/nginx/sites-available/ai-companion`：

```nginx
server {
    listen 80;
    server_name 101.33.76.14;  # 换成域名也可以

    client_max_body_size 10m;

    location / {
        proxy_pass http://127.0.0.1:10000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;

        # 超时设置（AI 响应可能慢）
        proxy_connect_timeout 60s;
        proxy_send_timeout 60s;
        proxy_read_timeout 120s;
    }
}
```

启用并重启：

```bash
ln -s /etc/nginx/sites-available/ai-companion /etc/nginx/sites-enabled/
nginx -t
systemctl restart nginx
```

### 3.6 配置 HTTPS（可选但推荐）

用 Let's Encrypt + Certbot 免费证书：

```bash
apt install -y certbot python3-certbot-nginx
certbot --nginx -d 你的域名.com
```

如果只有 IP，可以使用自签名证书，或保持 HTTP（内部使用问题不大）。

## 四、域名 vs IP

| 方案 | 优点 | 缺点 | 成本 |
|------|------|------|------|
| 直接用 IP | 免费，零配置 | 不好记，不太好看 | ¥0 |
| 域名 + HTTP | 好记，好看 | 需要买域名 | ~¥30/年 |
| 域名 + HTTPS | 安全，浏览器不报错 | 域名 + 证书配置 | ~¥30/年 |

建议：先用 IP 跑起来，想好名字了再买域名。

## 五、从 Render 迁移数据

### 5.1 聊天历史

存储在 MongoDB 的 `chats` 集合中。如果继续用远程 MongoDB，迁移后自动可用，无需操作。

如果需要导出备份：

```bash
# Render 环境导出
mongodump --uri="$DATABASE_URL" --out=./backup

# 传到腾讯云
scp -r ./backup root@101.33.76.14:/root/
```

### 5.2 记忆数据

同样存储在 MongoDB `memories` 集合中，同上。

### 5.3 对话摘要

存储在 `config/summary.json`，需要手动复制：

```bash
# Render 环境
scp /opt/render/project/src/config/summary.json root@101.33.76.14:/root/ai-companion/config/
```

### 5.4 用户设置（头像、主题等）

存储在 MongoDB `avatars` 集合和浏览器 localStorage。
- MongoDB 部分：自动可用
- localStorage 部分：用户浏览器缓存，迁移后首次访问需要重新设置

## 六、迁移后检查清单

- [ ] 服务器能通过 `http://101.33.76.14` 访问
- [ ] 页面正常加载（前端静态文件）
- [ ] 发送消息能收到 AI 回复
- [ ] MongoDB 连接正常，历史消息可查看
- [ ] 记忆系统正常工作（保存、读取）
- [ ] Telegram Bot 正常响应
- [ ] 其他功能：日历、任务、记账、足迹

## 七、Nginx 安全加固（可选）

```nginx
# 隐藏 Nginx 版本号
server_tokens off;

# 限制请求速率
limit_req_zone $binary_remote_addr zone=one:10m rate=10r/s;

# 禁止直接 IP 访问（如果有域名）
server {
    listen 80 default_server;
    return 444;
}
```

## 八、日常维护命令

```bash
# 查看进程状态
pm2 status
pm2 logs ai-companion

# 重启
pm2 restart ai-companion

# 更新代码
cd /root/ai-companion
git pull
pm2 restart ai-companion

# 查看资源占用
htop
df -h
free -h

# Nginx 日志
tail -f /var/log/nginx/access.log
tail -f /var/log/nginx/error.log
```

## 九、架构图（迁移后）

```
用户浏览器
    ↓ HTTP/HTTPS
腾讯云服务器 101.33.76.14
    ↓ 端口 80/443
Nginx (反向代理)
    ↓ 端口 10000
Node.js (Express + server.js)
    ├── 前端静态文件 (frontend/)
    ├── 路由
    │   ├── /api/chat      → AI 对话（OpenRouter）
    │   ├── /api/memory    → 记忆系统
    │   ├── /api/tasks     → 任务管理
    │   ├── /api/finance   → 记账
    │   ├── /api/calendar  → 日历
    │   └── /api/footprints → 足迹
    ├── Telegram Bot (可选)
    ├── 文件系统 (config/, docs/)
    └── MongoDB (远程 / 本地)
```

## 十、回退方案

如果迁移后发现问题，可以：
1. Render 上的服务不要停，保持运行
2. 修复腾讯云上的问题
3. 测试没问题后，再关掉 Render

两个环境可以共存，切换只是用户访问哪个 URL 的区别。

---

文档版本：v1.0
编写：Lumi
最后更新：基于 2026-07 项目状态
