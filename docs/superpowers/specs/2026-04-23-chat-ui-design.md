# 文字聊天 UI 增强设计

## 概述

为 VideoTogether 插件添加可视化的文字聊天功能，解决当前文字消息只能 TTS 朗读、无法查看聊天记录的问题。

**设计原则**：
- 不改动后端服务器，保持与官方服务器兼容
- 前端本地存储聊天记录
- 消息格式兼容现有协议

## 消息格式

### 新格式

```
{vt:昵称}消息内容
```

**示例**：
- 用户设置昵称为 "小明"
- 发送 "你好" → 实际发送 `{vt:小明}你好`

### 解析规则

收到消息时：
1. 用正则 `/\{vt:([^}]+)\}(.*)/` 解析
2. 提取 `昵称` 和 `消息内容`
3. 如果不匹配格式，整个消息作为内容，昵称为 "未知"

### TTS 处理

只朗读消息内容，过滤掉 `{vt:xxx}` 标签。

## UI 设计

### 两种形态

1. **悬浮图标形态**（未展开面板）
   - 收到消息时，气泡通知显示在图标旁边
   - 可配置显示时长（默认 5 秒）
   - 自动隐藏

2. **展开面板形态**
   - 完整聊天记录显示
   - 消息按时间顺序排列
   - 可滚动查看历史（在当前会话内）

### 布局方案 A：垂直扩展

```
┌─────────────────────────┐
│  聊天记录区域（滚动）     │  ← 新增
├─────────────────────────┤
│  房间名: xxx  成员: 2   │
│  [输入框]    [发送]     │  ← 现有
└─────────────────────────┘
   高度从 210px 扩展到 ~350px
```

### 消息显示样式

```
┌─────────────────────┐
│ [小明]: 你好啊       │  ← 对方消息（气泡样式，左对齐，浅蓝背景）
├─────────────────────┤
│        你在看什么: │  ← 自己消息（右对齐，浅绿背景）
└─────────────────────┘
```

## 数据存储

### 存储结构

```javascript
{
  roomId: {
    messages: [
      { sender: "小明", content: "你好", timestamp: 1234567890 },
      { sender: "我", content: "在看视频", timestamp: 1234567891 }
    ],
    lastActivity: 1234567891
  }
}
```

### 存储位置

- 使用 `chrome.storage.local` 或 `GM.setValue`（取决于扩展类型）
- Key 格式：`VideoTogetherChatHistory`

### 生命周期

- **创建**：用户加入房间时加载（如果之前有记录）
- **更新**：收到/发送消息时追加
- **清理**：用户手动清理（在设置页面）

## 实现要点

### 1. 消息解析

```javascript
function parseMessage(raw) {
  const match = raw.match(/\{vt:([^}]+)\}(.*)/);
  if (match) {
    return { sender: match[1], content: match[2] };
  }
  return { sender: "未知", content: raw };
}
```

### 2. TTS 过滤

```javascript
function getTTSContent(raw) {
  const match = raw.match(/\{vt:([^}]+)\}(.*)/);
  return match ? match[2] : raw;
}
```

### 3. 消息发送包装

```javascript
function wrapMessage(nickname, content) {
  return `{vt:${nickname}}${content}`;
}
```

### 4. 气泡通知

- 使用现有面板元素
- 定时器控制显示时长
- 超过时长自动隐藏

## 配置项

| 配置项 | 默认值 | 说明 |
|--------|--------|------|
| ChatBubbleDuration | 5000 | 气泡显示时长（毫秒） |
| ChatNickname | "" | 用户设置的昵称 |
| ChatHistory | {} | 聊天记录（按房间ID） |

## 不涉及的改动

- 后端服务器
- WebSocket 协议
- TTS 服务
- 视频同步逻辑

## 文件变更

- `source/extension/html/pannel.html` - 增加聊天记录显示区域
- `source/extension/vt.js` - 消息解析、TTS 过滤、UI 逻辑
- `source/extension/localization/*.json` - 新增国际化字符串
