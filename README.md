# Stork Oracle 自动机器人 不介意的可以使用我的邀请码：2R1ZZ3S8KG

用于 Stork Oracle 网络的自动验证机器人。此机器人帮助您自动化验证过程，通过 Stork Oracle 系统赚取奖励。

## 注册
- 下载插件 https://chromewebstore.google.com/detail/stork-verify/knnliglhgkmlblppdejchidfihjnockl
- 使用谷歌或者邮箱注册，不介意的话可以使用我的邀请码：2R1ZZ3S8KG

## 功能

- 自动从 Stork Oracle API 获取签名价格数据
- 根据预定义规则验证价格数据
- 将验证结果提交回 API
- 处理令牌刷新以持续运行
- 显示验证统计信息和用户信息
- 可配置的验证间隔
- 支持代理服务器以分发请求
- 多线程处理以提高性能

## 要求

- Node.js 14.0.0 或更高版本
- 有效的 Stork Oracle 账户

## 安装

1. 克隆仓库：
```
git clone https://github.com/Gzgod/Stork-Auto-Bot.git
```

2. 进入项目目录：
```
cd Stork-Auto-Bot
```

3. 安装依赖：
```
npm install
```

4. 配置您的凭据（请参见下面的配置部分）

## 配置

### 使用 account.js 进行简易设置

机器人现在使用 account.js 文件来存储凭据。

1. 编辑生成的 `accounts.js` 文件，添加您的凭据：
```javascript
export const accounts = [
  { username: "email1", password: "pass1" },
  { username: "email2", password: "pass2" }
];
```

2. 将 `username` 和 `password` 替换为您的 Stork Oracle 账户凭据。如果您想运行多个账户，只需添加新行。

3. 运行机器人：
```
node index.js
```

### 可选：代理配置

要使用代理服务器分发请求：

1. 在项目根目录创建一个 `proxies.txt` 文件
2. 每行添加一个代理，格式如下：
   - HTTP 代理：`http://user:pass@host:port`
   - SOCKS 代理：`socks5://user:pass@host:port`

## 使用

启动机器人：
```
node index.js
```

机器人将会：
1. 使用 account.js 中的凭据进行身份验证
2. 定期获取签名价格数据
3. 验证每个数据点
4. 将验证结果提交到 Stork Oracle
5. 显示您的当前统计信息

## 高级配置选项

在 `config.json` 文件中，您可以调整以下选项：

- `stork.intervalSeconds`：验证过程运行的时间间隔（以秒为单位）（默认：5）
- `threads.maxWorkers`：并发验证工作线程数（默认：1）

## 故障排除

- 如果看到身份验证错误，请检查 config.json 中的用户名和密码是否正确
- 如果机器人无法启动，请确保 config.json 文件是正确格式的 JSON
- 如果在成功身份验证后看到令牌相关错误，可能是 tokens.json 文件已损坏 - 删除它并让机器人重新生成
- 对于连接问题，请检查您的互联网连接并验证 Stork Oracle API 是否可访问
- 如果使用代理，请检查 proxies.txt 是否格式正确且代理是否正常工作

## 免责声明

此机器人仅供教育用途。使用风险自负。作者对使用此机器人可能导致的任何后果（包括但不限于账户终止或奖励损失）不承担任何责任。
