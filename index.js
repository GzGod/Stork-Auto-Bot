import AmazonCognitoIdentity from 'amazon-cognito-identity-js';
import axios from 'axios';
import fs from 'fs';
import path from 'path';
import { Worker, isMainThread, parentPort, workerData } from 'worker_threads';
import { HttpsProxyAgent } from 'https-proxy-agent';
import { SocksProxyAgent } from 'socks-proxy-agent';
import { accounts } from "./accounts.js";
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 加载配置文件 config.json
function loadConfig() {
  try {
    const configPath = path.join(__dirname, 'config.json');

    if (!fs.existsSync(configPath)) {
      log(`配置文件未在 ${configPath} 找到，使用默认配置`, 'WARN');
      const defaultConfig = {
        cognito: {
          region: 'ap-northeast-1',
          clientId: '5msns4n49hmg3dftp2tp1t2iuh',
          userPoolId: 'ap-northeast-1_M22I44OpC',
        },
        stork: {
          intervalSeconds: 30
        },
        threads: {
          maxWorkers: 1
        }
      };
      fs.writeFileSync(configPath, JSON.stringify(defaultConfig, null, 2), 'utf8');
      return defaultConfig;
    }
    
    const userConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    log('成功从 config.json 加载配置 \n');
    log('成功从 accounts.js 加载账户');
    return userConfig;
  } catch (error) {
    log(`加载配置出错: ${error.message}`, 'ERROR');
    throw new Error('加载配置失败');
  }
}

const userConfig = loadConfig();
const config = {
  cognito: {
    region: userConfig.cognito?.region || 'ap-northeast-1',
    clientId: userConfig.cognito?.clientId || '5msns4n49hmg3dftp2tp1t2iuh',
    userPoolId: userConfig.cognito?.userPoolId || 'ap-northeast-1_M22I44OpC',
    username: userConfig.cognito?.username || '',
    password: userConfig.cognito?.password || ''
  },
  stork: {
    baseURL: 'https://app-api.jp.stork-oracle.network/v1',
    authURL: 'https://api.jp.stork-oracle.network/auth',
    tokenPath: path.join(__dirname, 'tokens.json'),
    intervalSeconds: userConfig.stork?.intervalSeconds || 10,
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36',
    origin: 'chrome-extension://knnliglhgkmlblppdejchidfihjnockl'
  },
  threads: {
    maxWorkers: userConfig.threads?.maxWorkers || 10,
    proxyFile: path.join(__dirname, 'proxies.txt')
  }
};

function validateConfig() {
  if (!accounts[0].username || !accounts[0].password) {
    log('错误: 用户名和密码必须在 accounts.js 中设置', 'ERROR');
    console.log('\n请更新你的 accounts.js 文件，填写你的凭据:');
    console.log(JSON.stringify({
        username: "你的邮箱",
        password: "你的密码"
    }, null, 2));
    return false;
  }
  return true;
}

const poolData = { UserPoolId: config.cognito.userPoolId, ClientId: config.cognito.clientId };
const userPool = new AmazonCognitoIdentity.CognitoUserPool(poolData);

function getTimestamp() {
  const now = new Date();
  return now.toISOString().replace('T', ' ').substr(0, 19);
}

function getFormattedDate() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`;
}

function log(message, type = 'INFO') {
  console.log(`[${getFormattedDate()}] [${type}] ${message}`);
}

function loadProxies() {
  try {
    const rotate = arr => {
        for (let i = arr.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [arr[i], arr[j]] = [arr[j], arr[i]];
          }
        return arr;
      };
    if (!fs.existsSync(config.threads.proxyFile)) {
      log(`代理文件未在 ${config.threads.proxyFile} 找到，创建空文件`, 'WARN');
      fs.writeFileSync(config.threads.proxyFile, '', 'utf8');
      return [];
    }
    const proxyData = fs.readFileSync(config.threads.proxyFile, 'utf8');
    const proxies = proxyData
      .split('\n')
      .map(line => line.trim())
      .filter(line => line && !line.startsWith('#'));
    const rotatedProxy = rotate(proxies);
    log(`从 ${config.threads.proxyFile} 加载了 ${proxies.length} 个代理`);
    log(`尝试使用 ${rotatedProxy[0]} 运行`);
    return rotatedProxy;
  } catch (error) {
    log(`加载代理出错: ${error.message}`, 'ERROR');
    return [];
  }
}

async function retryWithBackoff(fn, maxRetries = 5, initialDelay = 1000) {
  let attempt = 0;
  while (attempt < maxRetries) {
    try {
      return await fn();
    } catch (error) {
      if (error.message.includes('Too many requests') || error.code === 'TooManyRequestsException') {
        attempt++;
        const delay = initialDelay * Math.pow(2, attempt) + Math.random() * 1000;
        log(`收到 Too Many Requests，第 ${attempt} 次重试，将等待 ${Math.round(delay/1000)} 秒`, 'WARN');
        
        if (attempt === maxRetries) {
          throw new Error('达到最大重试次数，放弃本次认证');
        }
        await new Promise(resolve => setTimeout(resolve, delay));
      } else {
        throw error;
      }
    }
  }
}

class CognitoAuth {
  constructor(username, password) {
    this.username = username;
    this.password = password;
    this.authenticationDetails = new AmazonCognitoIdentity.AuthenticationDetails({ Username: username, Password: password });
    this.cognitoUser = new AmazonCognitoIdentity.CognitoUser({ Username: username, Pool: userPool });
  }

  authenticate() {
    return new Promise((resolve, reject) => {
      this.cognitoUser.authenticateUser(this.authenticationDetails, {
        onSuccess: (result) => resolve({
          accessToken: result.getAccessToken().getJwtToken(),
          idToken: result.getIdToken().getJwtToken(),
          refreshToken: result.getRefreshToken().getToken(),
          expiresIn: result.getAccessToken().getExpiration() * 1000 - Date.now()
        }),
        onFailure: (err) => reject(err),
        newPasswordRequired: () => reject(new Error('需要新密码'))
      });
    });
  }

  refreshSession(refreshToken) {
    const refreshTokenObj = new AmazonCognitoIdentity.CognitoRefreshToken({ RefreshToken: refreshToken });
    return new Promise((resolve, reject) => {
      this.cognitoUser.refreshSession(refreshTokenObj, (err, result) => {
        if (err) reject(err);
        else resolve({
          accessToken: result.getAccessToken().getJwtToken(),
          idToken: result.getIdToken().getJwtToken(),
          refreshToken: refreshToken,
          expiresIn: result.getAccessToken().getExpiration() * 1000 - Date.now()
        });
      });
    });
  }
}

class TokenManager {
  constructor(i) {
    this.accessToken = null;
    this.refreshToken = null;
    this.idToken = null;
    this.expiresAt = null;
    this.auth = new CognitoAuth(accounts[i].username, accounts[i].password);
  }

  async getValidToken() {
    if (!this.accessToken || this.isTokenExpired()) await this.refreshOrAuthenticate();
    return this.accessToken;
  }

  isTokenExpired() {
    return Date.now() >= this.expiresAt;
  }

  async refreshOrAuthenticate() {
    const authFn = async () => {
      return this.refreshToken ? await this.auth.refreshSession(this.refreshToken) : await this.auth.authenticate();
    };

    try {
      const result = await retryWithBackoff(authFn);
      await this.updateTokens(result);
    } catch (error) {
      log(`令牌刷新/认证最终失败: ${error.message}`, 'ERROR');
      throw error;
    }
  }

  async updateTokens(result) {
    this.accessToken = result.accessToken;
    this.idToken = result.idToken;
    this.refreshToken = result.refreshToken;
    this.expiresAt = Date.now() + result.expiresIn;
    const tokens = { accessToken: this.accessToken, idToken: this.idToken, refreshToken: this.refreshToken, isAuthenticated: true, isVerifying: false };
    await saveTokens(tokens);
    log('令牌已更新并保存到 tokens.json');
  }
}

async function getTokens() {
  try {
    if (!fs.existsSync(config.stork.tokenPath)) throw new Error(`令牌文件未在 ${config.stork.tokenPath} 找到`);
    const tokensData = await fs.promises.readFile(config.stork.tokenPath, 'utf8');
    const tokens = JSON.parse(tokensData);
    if (!tokens.accessToken || tokens.accessToken.length < 20) throw new Error('无效的访问令牌');
    log(`成功读取访问令牌: ${tokens.accessToken.substring(0, 10)}...`);
    return tokens;
  } catch (error) {
    log(`读取令牌出错: ${error.message}`, 'ERROR');
    throw error;
  }
}

async function saveTokens(tokens) {
  try {
    await fs.promises.writeFile(config.stork.tokenPath, JSON.stringify(tokens, null, 2), 'utf8');
    log('令牌保存成功');
    return true;
  } catch (error) {
    log(`保存令牌出错: ${error.message}`, 'ERROR');
    return false;
  }
}

function getProxyAgent(proxy) {
  if (!proxy) return null;
  if (proxy.startsWith('http')) return new HttpsProxyAgent(proxy);
  if (proxy.startsWith('socks4') || proxy.startsWith('socks5')) return new SocksProxyAgent(proxy);
  throw new Error(`不支持的代理协议: ${proxy}`);
}

async function refreshTokens(refreshToken) {
  try {
    log('通过 Stork API 刷新访问令牌...');
    const response = await axios({
      method: 'POST',
      url: `${config.stork.authURL}/refresh`,
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': config.stork.userAgent,
        'Origin': config.stork.origin
      },
      data: { refresh_token: refreshToken }
    });
    const tokens = {
      accessToken: response.data.access_token,
      idToken: response.data.id_token || '',
      refreshToken: response.data.refresh_token || refreshToken,
      isAuthenticated: true,
      isVerifying: false
    };
    await saveTokens(tokens);
    log('通过 Stork API 成功刷新令牌');
    return tokens;
  } catch (error) {
    log(`令牌刷新失败: ${error.message}`, 'ERROR');
    throw error;
  }
}

async function getSignedPrices(tokens) {
  try {
    log('获取签名价格数据...');
    const response = await axios({
      method: 'GET',
      url: `${config.stork.baseURL}/stork_signed_prices`,
      headers: {
        'Authorization': `Bearer ${tokens.accessToken}`,
        'Content-Type': 'application/json',
        'Origin': config.stork.origin,
        'User-Agent': config.stork.userAgent
      }
    });
    const dataObj = response.data.data;
    const result = Object.keys(dataObj).map(assetKey => {
      const assetData = dataObj[assetKey];
      return {
        asset: assetKey,
        msg_hash: assetData.timestamped_signature.msg_hash,
        price: assetData.price,
        timestamp: new Date(assetData.timestamped_signature.timestamp / 1000000).toISOString(),
        ...assetData
      };
    });
    log(`成功检索到 ${result.length} 个签名价格`);
    return result;
  } catch (error) {
    log(`获取签名价格出错: ${error.message}`, 'ERROR');
    throw error;
  }
}

async function sendValidation(tokens, msgHash, isValid, proxy) {
  const sendRequest = async () => {
    const agent = getProxyAgent(proxy);
    const response = await axios({
      method: 'POST',
      url: `${config.stork.baseURL}/stork_signed_prices/validations`,
      headers: {
        'Authorization': `Bearer ${tokens.accessToken}`,
        'Content-Type': 'application/json',
        'Origin': config.stork.origin,
        'User-Agent': config.stork.userAgent
      },
      httpsAgent: agent,
      data: { msg_hash: msgHash, valid: isValid }
    });
    log(`✓ 验证成功，消息哈希: ${msgHash.substring(0, 10)}... 通过 ${proxy || '直接连接'}`);
    return response.data;
  };

  try {
    return await retryWithBackoff(sendRequest);
  } catch (error) {
    log(`✗ 验证失败，消息哈希: ${msgHash.substring(0, 10)}...: ${error.message}`, 'ERROR');
    throw error;
  }
}

async function getUserStats(tokens) {
  try {
    log('获取用户统计数据...');
    const response = await axios({
      method: 'GET',
      url: `${config.stork.baseURL}/me`,
      headers: {
        'Authorization': `Bearer ${tokens.accessToken}`,
        'Content-Type': 'application/json',
        'Origin': config.stork.origin,
        'User-Agent': config.stork.userAgent
      }
    });
    return response.data.data;
  } catch (error) {
    log(`获取用户统计数据出错: ${error.message}`, 'ERROR');
    throw error;
  }
}

function validatePrice(priceData) {
  try {
    log(`验证 ${priceData.asset || '未知资产'} 的数据`);
    if (!priceData.msg_hash || !priceData.price || !priceData.timestamp) {
      log('数据不完整，视为无效', 'WARN');
      return false;
    }
    const currentTime = Date.now();
    const dataTime = new Date(priceData.timestamp).getTime();
    const timeDiffMinutes = (currentTime - dataTime) / (1000 * 60);
    if (timeDiffMinutes > 60) {
      log(`数据太旧（${Math.round(timeDiffMinutes)} 分钟前）`, 'WARN');
      return false;
    }
    return true;
  } catch (error) {
    log(`验证出错: ${error.message}`, 'ERROR');
    return false;
  }
}

if (!isMainThread) {
  const { priceData, tokens, proxy } = workerData;

  async function validateAndSend() {
    try {
      const isValid = validatePrice(priceData);
      await sendValidation(tokens, priceData.msg_hash, isValid, proxy);
      parentPort.postMessage({ success: true, msgHash: priceData.msg_hash, isValid });
    } catch (error) {
      parentPort.postMessage({ success: false, error: error.message, msgHash: priceData.msg_hash });
    }
  }

  validateAndSend();
} else {
  let previousStats = { validCount: 0, invalidCount: 0 };

  async function runValidationProcess(tokenManager) {
    try {
      log('--------- 开始验证过程 ---------');
      const tokens = await getTokens();
      const initialUserData = await getUserStats(tokens);

      if (!initialUserData || !initialUserData.stats) {
        throw new Error('无法获取初始用户统计数据');
      }

      const initialValidCount = initialUserData.stats.stork_signed_prices_valid_count || 0;
      const initialInvalidCount = initialUserData.stats.stork_signed_prices_invalid_count || 0;

      if (previousStats.validCount === 0 && previousStats.invalidCount === 0) {
        previousStats.validCount = initialValidCount;
        previousStats.invalidCount = initialInvalidCount;
      }

      const signedPrices = await getSignedPrices(tokens);
      const proxies = await loadProxies();

      if (!signedPrices || signedPrices.length === 0) {
        log('没有数据需要验证');
        const userData = await getUserStats(tokens);
        displayStats(userData);
        return;
      }

      log(`使用 ${config.threads.maxWorkers} 个工作线程处理 ${signedPrices.length} 个数据点...`);
      const workers = [];
      const chunkSize = Math.ceil(signedPrices.length / config.threads.maxWorkers);
      const batches = [];
      for (let i = 0; i < signedPrices.length; i += chunkSize) {
        batches.push(signedPrices.slice(i, i + chunkSize));
      }

      for (let i = 0; i < Math.min(batches.length, config.threads.maxWorkers); i++) {
        const batch = batches[i];
        const proxy = proxies.length > 0 ? proxies[i % proxies.length] : null;

        batch.forEach(priceData => {
          workers.push(new Promise((resolve) => {
            const worker = new Worker(__filename, {
              workerData: { priceData, tokens, proxy }
            });
            worker.on('message', resolve);
            worker.on('error', (error) => resolve({ success: false, error: error.message }));
            worker.on('exit', () => resolve({ success: false, error: '工作线程退出' }));
          }));
        });
        
        if (i < batches.length - 1) {
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      }

      const results = await Promise.all(workers);
      const successCount = results.filter(r => r.success).length;
      log(`成功处理 ${successCount}/${results.length} 个验证`);

      const updatedUserData = await getUserStats(tokens);
      const newValidCount = updatedUserData.stats.stork_signed_prices_valid_count || 0;
      const newInvalidCount = updatedUserData.stats.stork_signed_prices_invalid_count || 0;

      const actualValidIncrease = newValidCount - previousStats.validCount;
      const actualInvalidIncrease = newInvalidCount - previousStats.invalidCount;

      previousStats.validCount = newValidCount;
      previousStats.invalidCount = newInvalidCount;

      displayStats(updatedUserData);
      log(`--------- 验证总结 ---------`);
      log(`总共处理的数据: ${newValidCount}`);
      log(`成功: ${actualValidIncrease}`);
      log(`失败: ${actualInvalidIncrease}`);
      log('--------- 完成 ---------');
      
      if (jobs < accounts.length) {
        setTimeout(() => main(), config.stork.intervalSeconds * 1000);
      } else if (jobs == accounts.length - 1 || jobs === accounts.length) {
        jobs = 0;
        setTimeout(() => main(), config.stork.intervalSeconds * 1000);
      }
    } catch (error) {
      log(`验证过程出错: ${error.message}`, 'ERROR');
      setTimeout(() => runValidationProcess(tokenManager), 60 * 1000);
    }
  }

  function displayStats(userData) {
    if (!userData || !userData.stats) {
      log('没有可用的有效统计数据来显示', 'WARN');
      return;
    }

    console.clear();
    console.log('=============================================');
    console.log('STORK ORACLE  --   推特雪糕战神汉化@Hy78516012  ');
    console.log('=============================================');
    console.log(`时间: ${getTimestamp()}`);
    console.log('---------------------------------------------');
    console.log(`用户: ${userData.email || '无'}`);
    console.log(`ID: ${userData.id || '无'}`);
    console.log(`推荐码: ${userData.referral_code || '无'}`);
    console.log('---------------------------------------------');
    console.log('验证统计:');
    console.log(`✓ 有效验证: ${userData.stats.stork_signed_prices_valid_count || 0}`);
    console.log(`✗ 无效验证: ${userData.stats.stork_signed_prices_invalid_count || 0}`);
    console.log(`↻ 最后验证时间: ${userData.stats.stork_signed_prices_last_verified_at || '从未'}`);
    console.log(`👥 推荐使用次数: ${userData.stats.referral_usage_count || 0}`);
    console.log('---------------------------------------------');
    console.log(`下次验证将在 ${config.stork.intervalSeconds} 秒后进行...`);
    console.log('=============================================');
  }

  async function main() {
    if (!validateConfig()) {
      process.exit(1);
    }
    
    log(`正在处理 ${accounts[jobs].username}`);
    const tokenManager = new TokenManager(jobs);

    try {
      await tokenManager.getValidToken();
      log('初始认证成功');

      runValidationProcess(tokenManager);
      
      setInterval(async () => {
        await tokenManager.getValidToken();
        log('通过 Cognito 刷新令牌');
      }, 50 * 60 * 1000);

      // 成功处理后才增加 jobs 计数器
      jobs++;
    } catch (error) {
      log(`应用程序启动失败: ${error.message}`, 'ERROR');
      
      if (error.message.includes('Password attempts exceeded')) {
        // 处理密码尝试次数超限的情况
        log(`账号 ${accounts[jobs].username} 密码尝试次数超限，跳过此账号`, 'WARN');
        
        if (jobs < accounts.length - 1) {
          // 如果不是最后一个账号，跳到下一个
          jobs++;
          setTimeout(() => main(), 1000); // 短暂延迟后处理下一个账号
        } else {
          // 如果是最后一个账号，返回第一个
          jobs = 0;
          log('已是最后一个账号，返回处理第一个账号', 'INFO');
          setTimeout(() => main(), 1000);
        }
      } else {
        // 其他错误，等待60秒后重试当前账号
        setTimeout(() => main(), 60 * 1000);
      }
    }
  }
  
  let jobs = 0;
  main();
}
