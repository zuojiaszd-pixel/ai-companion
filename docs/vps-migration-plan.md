# VPS 迁移部署方案

## 1. 概述

将 AI Companion 项目从 Render 迁移到腾讯云轻量应用服务器（首尔节点）。

- **服务器 IP**：101.33.76.14
- **系统**：Ubuntu
- **配置**：3.6G 内存 / 59G 硬盘
- **访问方式**：直接 HTTP 访问或绑定域名

---

## 2. 架构设计

### 2.1 最终架构

```
用户浏览器
    ↕ HTTP/HTTPS
Nginx (反向代理，端口 80/443)
    ↕ 代理转发
Node.js (PM2 托管，监听 3000 端口)
    ↕
MongoDB (本地或远程)
```

### 2.2 组件说明

| 组件 | 角色 | 说明 |
|------|------|------|
| Nginx | 反向代理 | 对外暴露 80/443 端口，转发到后端 |
| Node.js | 后端服务 | Express + Socket.IO，核心业务逻辑 |
| PM2 | 进程管理 | 保持 Node 进程在线，自动重启 |
| MongoDB | 数据库 | 存储用户数据、对话记录、记忆 |

---

## 3. 环境准备

### 3.1 Node.js 安装

```bash
# 使用 nvm 安装
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash
source ~/.bashrc
nvm install 20
node -v  # 确认版本
```

### 3.2 MongoDB 安装

选项 A：本地安装（推荐，省事）

```bash
# Ubuntu 22.04 安装 MongoDB 7.0
curl -fsSL https://www.mongodb.org/static/pgp/server-7.0.asc | sudo gpg -o /usr/share/keyrings/mongodb-server-7.0.gpg --dearmor
echo "deb [ signed-by=/usr/share/keyrings/mongodb-server-7.0.gpg ] https://repo.mongodb.org/apt/ubuntu jammy/mongodb-org/7.0 multiverse" | sudo tee /etc/apt/sources.list.d/mongodb-org-7.0.list
sudo apt update
sudo apt install -y mongodb-org
sudo systemctl start mongod
sudo systemctl enable mongod
```

选项 B：继续使用现有 MongoDB Atlas（跳过）

### 3.3 Nginx 安装

```bash
sudo apt install nginx -y
sudo systemctl start nginx
sudo systemctl enable nginx
```

---

## 4. 部署步骤

### 4.1 拉取代码

```bash
cd /home/zuojiaszd/ai-companion
git pull origin main
```

如果还没有代码：

```bash
git clone https://github.com/zuojiaszd-pixel/ai-companion.git /home/zuojiaszd/ai-companion
```

### 4.2 安装依赖

```bash
cd /home/zuojiaszd/ai-companion
npm install
```

### 4.3 配置环境变量

创建 `.env` 文件：

```bash
cp .env.example .env  # 如果有示例文件
nano .env             # 手动编辑
```

需要配置的变量：

- `PORT` — 后端端口（3000）
- `MONGODB_URI` — 数据库连接串
- `SESSION_SECRET` — Session 密钥
- `GITHUB_TOKEN` — 如需代码推送等功能
- `OPENAI_API_KEY` — 如使用 AI 对话功能

### 4.4 使用 PM2 启动

```bash
npm install -g pm2
pm2 start app.js --name ai-companion
pm2 save
pm2 startup  # 设置开机自启
```

### 4.5 配置 Nginx 反向代理

编辑 `/etc/nginx/sites-available/default`：

```nginx
server {
    listen 80;
    server_name _;  # 或填写域名

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_cache_bypass $http_upgrade;
    }
}
```

重启 Nginx：

```bash
sudo nginx -t          # 测试配置
sudo systemctl restart nginx
```

---

## 5. 域名与 HTTPS（可选）

### 5.1 绑定域名

如果需要域名访问，在 DNS 服务商添加 A 记录指向 `101.33.76.14`。

修改 Nginx 配置中的 `server_name` 为域名。

### 5.2 配置 HTTPS（使用 Let's Encrypt）

```bash
sudo apt install certbot python3-certbot-nginx -y
sudo certbot --nginx -d your-domain.com
```

certbot 会自动配置 SSL 证书并续期。

---

## 6. 数据迁移

如果当前使用 Render 的 MongoDB（假设在 MongoDB Atlas 或 Render 内置）：

### 6.1 从源导出

```bash
mongodump --uri="<源MongoDB连接串>" --out=./backup
```

### 6.2 导入到本地

```bash
mongorestore --uri="mongodb://localhost:27017/ai-companion" ./backup/<数据库名>
```

如果继续使用 MongoDB Atlas，则不需要迁移数据，只需在 `.env` 中配置 Atlas 连接串。

---

## 7. 测试与验证

部署后检查：

1. `curl http://localhost:3000` — 后端是否在本机正常响应
2. `curl http://101.33.76.14` — 通过公网 IP 是否能访问
3. WebSocket 连接是否正常（聊天功能关键）
4. MongoDB 数据是否完整

---

## 8. Render 解绑

确认 VPS 上一切正常后：

1. Render 上停止服务
2. Render 上删除服务（可选，保留备份也行）
3. 更新 GitHub 上仓库的文档（如有必要）
4. 修改项目中的回调 URL、Webhook 等指向新地址

---

## 9. 后续优化建议

| 项目 | 说明 | 优先级 |
|------|------|--------|
| HTTPS | 配置 SSL 证书 | 中 |
| 域名 | 绑定友好域名 | 低 |
| 自动备份 | 定期备份 MongoDB | 高 |
| 监控 | 使用 PM2 监控或接入 uptime 服务 | 中 |
| 防火墙 | 配置 ufw，只开放必要端口 | 高 |
| 内存优化 | 如有性能问题，优化 Node 内存使用 | 中 |

---

## 10. 故障排查

常见问题：

- **502 Bad Gateway** — Node 服务未启动或端口不匹配，检查 PM2 状态
- **403 Forbidden** — Nginx 权限问题，检查目录权限
- **WebSocket 连接失败** — 确认 Nginx 配置了 Upgrade 头
- **MongoDB 连接失败** — 检查 MongoDB 服务是否在运行
