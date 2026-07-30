# 🚨 急救手册

## 网页打不开了怎么办

### 第一步：看看服务器还活着没
```bash
# 登录服务器
ssh root@101.33.76.14

# 检查服务状态
pm2 list
```

### 第二步：如果服务挂了
```bash
# 重启服务
cd ~/ai-companion && pm2 restart 0

# 或者重新启动
cd ~/ai-companion && pm2 start server.js --name ai-companion
```

### 第三步：看日志找原因
```bash
# 看最近日志
pm2 logs

# 只看错误
pm2 logs --err

# 看应用日志
cat ~/ai-companion/server.log
```

### 第四步：端口被占了
```bash
# 查谁占了10000端口
lsof -i :10000

# 杀掉占用的进程
kill -9 进程ID
```

### 第五步：代码更新了没生效
```bash
cd ~/ai-companion
git pull
pm2 restart 0
```

### 常用命令速查
| 想干嘛 | 敲什么 |
|--------|--------|
| 看服务活着没 | `pm2 list` |
| 重启服务 | `pm2 restart 0` |
| 看实时日志 | `pm2 logs` |
| 停服务 | `pm2 stop 0` |
| 查端口 | `lsof -i :10000` |
| 查进程 | `ps aux \| grep node` |
| 拉最新代码 | `git pull` |

### 终极手段
如果以上都不行：
```bash
# 重启服务器
reboot

# 重启后pm2会自动拉起来
```
