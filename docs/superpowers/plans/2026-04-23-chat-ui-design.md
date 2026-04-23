# 文字聊天 UI 增强实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**目标：** 为 VideoTogether 插件添加可视化聊天功能，支持查看聊天记录和气泡通知

**架构：**
- 消息格式 `{vt:昵称}消息内容`，发送时包装，接收时解析
- TTS 过滤标签，只朗读消息内容
- 聊天记录本地存储，按房间隔离
- 两种 UI 形态：气泡通知（悬浮时）+ 展开面板（查看历史）

**技术栈：** 纯 JavaScript，chrome.storage.local / GM.getValue/setValue

---

## 文件变更概览

| 文件 | 变更类型 | 职责 |
|------|----------|------|
| `source/extension/vt.js` | 修改 | 消息解析、TTS 过滤、聊天 UI 逻辑 |
| `source/extension/html/pannel.html` | 修改 | 增加聊天记录显示区域 |
| `source/extension/localization/en-us.json` | 修改 | 新增国际化字符串 |
| `source/extension/localization/zh-cn.json` | 修改 | 新增国际化字符串 |
| `source/extension/localization/ja-jp.json` | 修改 | 新增国际化字符串 |

---

## Task 1: 消息解析与包装工具函数

**Files:**
- Modify: `source/extension/vt.js` (在文件顶部添加工具函数)

- [ ] **Step 1: 添加消息解析和包装函数**

在 `GotTxtMsgCallback` 定义附近（约1233行），添加：

```javascript
// 消息格式: {vt:昵称}消息内容
function parseMessage(raw) {
    const match = raw.match(/^\{vt:([^}]+)\}(.*)$/);
    if (match) {
        return { sender: match[1], content: match[2] };
    }
    return { sender: "未知", content: raw };
}

function wrapMessage(nickname, content) {
    return `{vt:${nickname}}${content}`;
}

function getTTSContent(raw) {
    const match = raw.match(/^\{vt:([^}]+)\}(.*)$/);
    return match ? match[2] : raw;
}
```

- [ ] **Step 2: 验证函数正确性**

运行测试确认正则能正确解析：
- `{vt:小明}你好` → sender: "小明", content: "你好"
- `普通消息` → sender: "未知", content: "普通消息"

- [ ] **Step 3: 提交**

```bash
git add source/extension/vt.js
git commit -m "feat(chat): add message parse and wrap functions"
```

---

## Task 2: 修改消息发送逻辑

**Files:**
- Modify: `source/extension/vt.js:1348-1350` (textMessageSend onclick)

- [ ] **Step 1: 修改发送逻辑，包装消息**

找到（约1348行）：
```javascript
wrapper.querySelector("#textMessageSend").onclick = async () => {
    extension.currentSendingMsgId = generateUUID();
    WS.sendTextMessage(extension.currentSendingMsgId, select("#textMessageInput").value);
}
```

改为：
```javascript
wrapper.querySelector("#textMessageSend").onclick = async () => {
    extension.currentSendingMsgId = generateUUID();
    const nickname = await getGM().getValue("ChatNickname") || "匿名用户";
    const content = select("#textMessageInput").value;
    const wrappedMsg = wrapMessage(nickname, content);
    WS.sendTextMessage(extension.currentSendingMsgId, wrappedMsg);
}
```

- [ ] **Step 2: 同样修改全屏模式的发送逻辑**

约1284-1287行：
```javascript
sendBtn.onclick = () => {
    extension.currentSendingMsgId = generateUUID();
    sendMessageToTop(MessageType.SendTxtMsg, { currentSendingMsgId: extension.currentSendingMsgId, value: msgInput.value });
}
```

改为：
```javascript
sendBtn.onclick = async () => {
    extension.currentSendingMsgId = generateUUID();
    const nickname = await getGM().getValue("ChatNickname") || "匿名用户";
    const content = msgInput.value;
    const wrappedMsg = wrapMessage(nickname, content);
    sendMessageToTop(MessageType.SendTxtMsg, { currentSendingMsgId: extension.currentSendingMsgId, value: wrappedMsg });
}
```

- [ ] **Step 3: 提交**

```bash
git add source/extension/vt.js
git commit -m "feat(chat): wrap messages with nickname on send"
```

---

## Task 3: 修改 TTS 逻辑，过滤标签

**Files:**
- Modify: `source/extension/vt.js` (找到 TTS 相关代码)

- [ ] **Step 1: 找到 TTS 处理函数**

搜索 `GotTxtMsgCallback` 的使用位置，找到 TTS 朗读逻辑：
约1288行附近：
```javascript
GotTxtMsgCallback = (id, msg) => {
    console.log(id, msg);
    if (id == extension.currentSendingMsgId && msg == msgInput.value) {
        msgInput.value = "";
    }
}
```

这里需要加入 TTS 过滤。找到调用 TTS 的地方（可能在 `enableSpeechSynthesis` 方法中）。

- [ ] **Step 2: 修改 GotTxtMsgCallback 加入 TTS 过滤**

```javascript
GotTxtMsgCallback = (id, msg) => {
    console.log(id, msg);
    // 过滤标签后朗读
    const ttsContent = getTTSContent(msg);
    if (ttsContent && ttsContent.trim()) {
        this.speak(ttsContent);
    }
    if (id == extension.currentSendingMsgId && msg == msgInput.value) {
        msgInput.value = "";
    }
}
```

- [ ] **Step 3: 提交**

```bash
git add source/extension/vt.js
git commit -m "feat(chat): filter vt tag before TTS"
```

---

## Task 4: 添加聊天记录存储结构

**Files:**
- Modify: `source/extension/vt.js` (在顶部添加存储相关代码)

- [ ] **Step 1: 添加聊天记录存储函数**

在 `GotTxtMsgCallback` 定义前（约1230行）添加：

```javascript
// 聊天记录存储
async function getChatHistory() {
    try {
        const history = await getGM().getValue("ChatHistory");
        return history || {};
    } catch {
        return {};
    }
}

async function saveChatHistory(history) {
    await getGM().setValue("ChatHistory", history);
}

async function addMessageToHistory(roomId, sender, content, isSelf) {
    const history = await getChatHistory();
    if (!history[roomId]) {
        history[roomId] = { messages: [], lastActivity: Date.now() };
    }
    history[roomId].messages.push({
        sender: sender,
        content: content,
        timestamp: Date.now(),
        isSelf: isSelf
    });
    history[roomId].lastActivity = Date.now();
    await saveChatHistory(history);
}

async function getRoomChatHistory(roomId) {
    const history = await getChatHistory();
    return history[roomId]?.messages || [];
}

async function clearRoomChatHistory(roomId) {
    const history = await getChatHistory();
    if (history[roomId]) {
        delete history[roomId];
        await saveChatHistory(history);
    }
}
```

- [ ] **Step 2: 修改消息接收逻辑，存储消息**

修改 `GotTxtMsgCallback`：
```javascript
GotTxtMsgCallback = async (id, msg) => {
    console.log(id, msg);
    const parsed = parseMessage(msg);
    const roomId = extension.ctxRoomId || "default";

    // 存储到历史记录
    await addMessageToHistory(roomId, parsed.sender, parsed.content, id == extension.currentSendingMsgId);

    // TTS 过滤
    const ttsContent = getTTSContent(msg);
    if (ttsContent && ttsContent.trim()) {
        this.speak(ttsContent);
    }
    if (id == extension.currentSendingMsgId) {
        select("#textMessageInput").value = "";
    }
}
```

- [ ] **Step 3: 提交**

```bash
git add source/extension/vt.js
git commit -m "feat(chat): add chat history storage"
```

---

## Task 5: 修改 HTML 添加聊天记录显示区域

**Files:**
- Modify: `source/extension/html/pannel.html` (在 #mainPannel 中添加聊天区域)

- [ ] **Step 1: 添加聊天记录区域**

找到（约92行）：
```html
<div id="textMessageChat" style="display: none;">
    <input id="textMessageInput" autocomplete="off" placeholder="{$textMessageInput$}">
    <button id="textMessageSend" class="vt-btn vt-btn-primary" type="button">
        <span>{$textMessageSend$}</span>
    </button>
</div>
```

改为：
```html
<div id="textMessageChat" style="display: none;">
    <div id="chatHistory" style="max-height: 120px; overflow-y: auto; margin-bottom: 8px; text-align: left;"></div>
    <div style="display: flex; gap: 6px;">
        <input id="textMessageInput" autocomplete="off" placeholder="{$textMessageInput$}">
        <button id="textMessageSend" class="vt-btn vt-btn-primary" type="button">
            <span>{$textMessageSend$}</span>
        </button>
    </div>
</div>
```

- [ ] **Step 2: 添加聊天消息样式**

在 `<style>` 区域末尾添加：
```css
.chat-message {
    padding: 4px 8px;
    border-radius: 8px;
    margin-bottom: 4px;
    font-size: 12px;
    max-width: 90%;
    word-wrap: break-word;
}
.chat-message.self {
    background-color: #e8f5e9;
    margin-left: 10%;
    text-align: right;
}
.chat-message.other {
    background-color: #e3f2fd;
    text-align: left;
}
.chat-message .sender {
    font-size: 10px;
    font-weight: bold;
    margin-bottom: 2px;
    color: #666;
}
```

- [ ] **Step 3: 提交**

```bash
git add source/extension/html/pannel.html
git commit -m "feat(chat): add chat history display area to panel"
```

---

## Task 6: 添加聊天消息渲染逻辑

**Files:**
- Modify: `source/extension/vt.js` (添加渲染函数)

- [ ] **Step 1: 添加渲染聊天记录的函数**

在 `GotTxtMsgCallback` 定义前添加：

```javascript
function renderChatMessage(chatHistoryEl, sender, content, isSelf) {
    const msgDiv = document.createElement("div");
    msgDiv.className = `chat-message ${isSelf ? 'self' : 'other'}`;
    msgDiv.innerHTML = `<div class="sender">${isSelf ? '我' : sender}</div><div class="content">${escapeHtml(content)}</div>`;
    chatHistoryEl.appendChild(msgDiv);
    chatHistoryEl.scrollTop = chatHistoryEl.scrollHeight;
}

function escapeHtml(text) {
    const div = document.createElement("div");
    div.textContent = text;
    return div.innerHTML;
}
```

- [ ] **Step 2: 修改 GotTxtMsgCallback 渲染消息**

修改 `GotTxtMsgCallback`：
```javascript
GotTxtMsgCallback = async (id, msg) => {
    const parsed = parseMessage(msg);
    const roomId = extension.ctxRoomId || "default";
    const isSelf = id == extension.currentSendingMsgId;

    // 存储到历史记录
    await addMessageToHistory(roomId, parsed.sender, parsed.content, isSelf);

    // 渲染到 UI
    const chatHistoryEl = select("#chatHistory");
    if (chatHistoryEl) {
        renderChatMessage(chatHistoryEl, parsed.sender, parsed.content, isSelf);
    }

    // TTS 过滤
    const ttsContent = getTTSContent(msg);
    if (ttsContent && ttsContent.trim()) {
        this.speak(ttsContent);
    }
    if (isSelf) {
        select("#textMessageInput").value = "";
    }
}
```

- [ ] **Step 3: 添加进入房间时加载历史记录**

找到 `setTxtMsgInterface` 方法（约1564行），在显示聊天界面时加载历史：

```javascript
setTxtMsgInterface(type) {
    // ... 现有代码 ...
    if (type == 1) {
        show(this.textMessageChat);
        // 加载聊天历史
        this.loadChatHistory();
    }
}

// 在 VideoTogetherFlyPannel 类中添加 loadChatHistory 方法
loadChatHistory() {
    const chatHistoryEl = select("#chatHistory");
    if (!chatHistoryEl) return;
    chatHistoryEl.innerHTML = "";
    const roomId = extension.ctxRoomId || "default";
    getRoomChatHistory(roomId).then(messages => {
        messages.forEach(msg => {
            renderChatMessage(chatHistoryEl, msg.sender, msg.content, msg.isSelf);
        });
    });
}
```

- [ ] **Step 4: 提交**

```bash
git add source/extension/vt.js
git commit -m "feat(chat): add chat message rendering logic"
```

---

## Task 7: 添加气泡通知功能

**Files:**
- Modify: `source/extension/vt.js` (在 VideoTogetherFlyPannel 类中添加气泡通知)

- [ ] **Step 1: 添加气泡显示方法**

在 `VideoTogetherFlyPannel` 类中添加：

```javascript
showBubbleNotification(sender, content) {
    const smallIcon = select("#videoTogetherSamllIcon");
    if (!smallIcon) return;

    // 移除已有的气泡
    const existingBubble = select("#chatBubble");
    if (existingBubble) existingBubble.remove();

    // 创建气泡
    const bubble = document.createElement("div");
    bubble.id = "chatBubble";
    bubble.style.cssText = `
        position: fixed;
        bottom: 45px;
        right: 15px;
        background: #fff;
        border: 1px solid #ddd;
        border-radius: 8px;
        padding: 8px 12px;
        box-shadow: 0 2px 8px rgba(0,0,0,0.15);
        max-width: 200px;
        font-size: 12px;
        z-index: 2147483647;
    `;
    bubble.innerHTML = `<strong>${escapeHtml(sender)}:</strong> ${escapeHtml(content)}`;

    document.body.appendChild(bubble);

    // 获取显示时长配置
    getGM().getValue("ChatBubbleDuration").then(duration => {
        setTimeout(() => {
            bubble.remove();
        }, duration || 5000);
    });
}
```

- [ ] **Step 2: 在收到消息且面板未展开时显示气泡**

修改 `GotTxtMsgCallback`，在面板最小化时显示气泡：

```javascript
GotTxtMsgCallback = async (id, msg) => {
    const parsed = parseMessage(msg);
    const roomId = extension.ctxRoomId || "default";
    const isSelf = id == extension.currentSendingMsgId;

    // 自己发的消息不显示气泡
    if (!isSelf) {
        const chatHistoryEl = select("#chatHistory");
        // 如果聊天区域不可见，显示气泡
        if (!chatHistoryEl || chatHistoryEl.offsetParent === null) {
            this.showBubbleNotification(parsed.sender, parsed.content);
        }
    }

    // 存储和渲染逻辑...
}
```

- [ ] **Step 3: 提交**

```bash
git add source/extension/vt.js
git commit -m "feat(chat): add bubble notification for minimized state"
```

---

## Task 8: 添加国际化字符串

**Files:**
- Modify: `source/extension/localization/en-us.json`
- Modify: `source/extension/localization/zh-cn.json`
- Modify: `source/extension/localization/ja-jp.json`

- [ ] **Step 1: 添加英文字符串**

在 `en-us.json` 添加：
```json
"chatHistory": "Chat History",
"clearChatHistory": "Clear Chat History",
"chatHistoryCleared": "Chat history cleared",
"chatBubbleDuration": "Bubble Duration (seconds)",
"chatNickname": "Your Nickname"
```

- [ ] **Step 2: 添加中文字符串**

在 `zh-cn.json` 添加：
```json
"chatHistory": "聊天记录",
"clearChatHistory": "清空聊天记录",
"chatHistoryCleared": "聊天记录已清空",
"chatBubbleDuration": "气泡显示时长（秒）",
"chatNickname": "你的昵称"
```

- [ ] **Step 3: 添加日文字符串**

在 `ja-jp.json` 添加：
```json
"chatHistory": "チャット履歴",
"clearChatHistory": "チャット履歴をクリア",
"chatHistoryCleared": "チャット履歴がクリアされました",
"chatBubbleDuration": "泡表示時間（秒）",
"chatNickname": "あなたのニックネーム"
```

- [ ] **Step 4: 提交**

```bash
git add source/extension/localization/*.json
git commit -m "feat(chat): add i18n strings for chat feature"
```

---

## Task 9: 添加昵称设置功能

**Files:**
- Modify: `source/extension/vt.js` (添加昵称设置逻辑)

- [ ] **Step 1: 在发送消息时确保有昵称**

确认 `wrapMessage` 调用时已处理空昵称情况（已在 Task 2 中处理，默认 "匿名用户"）。

- [ ] **Step 2: 提交**

```bash
git add source/extension/vt.js
git commit -m "feat(chat): add nickname default value"
```

---

## Task 10: 添加退出房间时清空聊天的入口（可选）

**Files:**
- Modify: `source/extension/vt.js`

- [ ] **Step 1: 添加手动清空方法**

在适当位置添加清空按钮的逻辑，用户可以在设置页面清空。

- [ ] **Step 2: 提交**

```bash
git add source/extension/vt.js
git commit -m "feat(chat): add manual clear chat history option"
```

---

## 实现检查清单

- [ ] 消息发送时包装 `{vt:昵称}内容`
- [ ] 消息接收时解析出昵称和内容
- [ ] TTS 只朗读过滤后的内容
- [ ] 聊天记录显示在面板中
- [ ] 气泡通知在悬浮图标时显示
- [ ] 聊天记录按房间存储
- [ ] 国际化字符串已添加

---

**Plan complete and saved to `docs/superpowers/plans/2026-04-23-chat-ui-design.md`**

**Two execution options:**

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

Which approach?
