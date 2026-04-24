# Panel UI Modernization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Update the non-fullscreen panel UI to be modern, lightweight style with larger chat area and nickname editing feature

**Architecture:** Modify the existing pannel.html file with updated CSS styles and HTML structure, add nickname dropdown functionality in vt.js

**Tech Stack:** Vanilla HTML/CSS/JS, Tampermonkey/Greasemonkey extension

---

## Files

- Modify: `source/extension/html/pannel.html` - Main panel UI
- Modify: `source/extension/vt.js` - Add nickname dropdown click handlers and input functionality

---

## Task 1: Update pannel.html CSS (dimensions, shadows, border-radius)

**Files:**
- Modify: `source/extension/html/pannel.html:269-834`

- [ ] **Step 1: Update panel dimensions and main shadow**

Find the `#videoTogetherFlyPannel` CSS block (line 276-290) and replace with:

```css
  #videoTogetherFlyPannel {
    background-color: #ffffff !important;
    display: block;
    z-index: 2147483647;
    position: fixed;
    bottom: 15px;
    right: 15px;
    width: 280px;
    height: 420px;
    text-align: center;
    border: none !important;
    box-shadow: 0 4px 20px rgba(0,0,0,0.08);
    border-radius: 16px;
    line-height: 1.2;
  }
```

- [ ] **Step 2: Update header styles (border-radius, padding)**

Find `.vt-modal-header` (line 387-395) and replace with:

```css
  .vt-modal-header {
    display: flex;
    padding: 8px 12px;
    color: #000000d9;
    background: #fff;
    border-bottom: 1px solid #f0f0f0;
    border-radius: 16px 16px 0 0;
    align-items: center;
    height: 36px;
    box-sizing: border-box;
  }
```

- [ ] **Step 3: Update modal-body to have proper height and flex layout**

Find `.vt-modal-body` (line 407-417) and replace with:

```css
  .vt-modal-body {
    height: calc(100% - 36px - 140px);
    min-height: 180px;
    display: flex;
    flex-direction: column;
    align-items: center;
    overflow-y: auto;
    font-size: 14px;
    color: black;
    background-size: cover;
    padding: 12px;
    box-sizing: border-box;
  }
```

- [ ] **Step 4: Update modal-footer position and padding**

Find `.vt-modal-footer` (line 419-432) and replace with:

```css
  .vt-modal-footer {
    padding: 10px 12px;
    text-align: center;
    background: transparent;
    border-top: 1px solid #f0f0f0;
    display: flex;
    flex-direction: column;
    gap: 8px;
    position: absolute;
    bottom: 0;
    left: 0;
    right: 0;
    box-sizing: border-box;
  }
```

- [ ] **Step 5: Update button styles (border-radius, transitions)**

Find `.vt-btn` (line 434-459) and replace with:

```css
  .vt-btn {
    line-height: 1.5715;
    position: relative;
    display: inline-block;
    font-weight: 400;
    white-space: nowrap;
    text-align: center;
    background-image: none;
    border: 1px solid transparent;
    cursor: pointer;
    transition: all .3s cubic-bezier(.645, .045, .355, 1);
    -webkit-user-select: none;
    -moz-user-select: none;
    user-select: none;
    touch-action: manipulation;
    height: 32px;
    padding: 4px 15px;
    font-size: 14px;
    border-radius: 8px;
    color: #000000d9;
    border-color: #d9d9d9;
    background: #fff;
    outline: 0;
  }
```

- [ ] **Step 6: Add chat message bubble styles**

Find `.chat-message` (line 811-833) and replace with:

```css
  .chat-message {
    padding: 8px 12px;
    border-radius: 12px;
    margin-bottom: 6px;
    font-size: 13px;
    max-width: 85%;
    word-wrap: break-word;
    line-height: 1.4;
  }
  .chat-message.self {
    background-color: #e8f5e9;
    margin-left: 15%;
    text-align: right;
    border-bottom-right-radius: 4px;
  }
  .chat-message.other {
    background-color: #f0f2f5;
    text-align: left;
    border-bottom-left-radius: 4px;
  }
  .chat-message .sender {
    font-size: 11px;
    font-weight: 600;
    margin-bottom: 2px;
    color: #666;
  }
  .chat-message .content {
    color: #1f1f1f;
  }
```

- [ ] **Step 7: Add nickname dropdown styles**

Add before the closing `</style>` tag (line ~834):

```css
  .nickname-dropdown {
    position: relative;
    display: inline-block;
    margin-left: auto;
    margin-right: 8px;
  }
  .nickname-btn {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 4px 8px;
    background: #f5f5f5;
    border-radius: 6px;
    cursor: pointer;
    font-size: 12px;
    color: #000000d9;
    border: none;
    transition: background 0.2s;
  }
  .nickname-btn:hover {
    background: #e8e8e8;
  }
  .nickname-menu {
    display: none;
    position: absolute;
    top: 100%;
    right: 0;
    background: #fff;
    border-radius: 8px;
    box-shadow: 0 4px 12px rgba(0,0,0,0.15);
    min-width: 120px;
    z-index: 1000;
    padding: 4px 0;
    margin-top: 4px;
  }
  .nickname-menu.show {
    display: block;
  }
  .nickname-menu-item {
    padding: 8px 12px;
    font-size: 13px;
    cursor: pointer;
    color: #000000d9;
  }
  .nickname-menu-item:hover {
    background: #f5f5f5;
  }
  .nickname-input-container {
    display: none;
    padding: 8px 12px;
    gap: 6px;
  }
  .nickname-input-container.show {
    display: flex;
  }
  .nickname-input-container input {
    flex: 1;
    padding: 6px 8px;
    border: 1px solid #d9d9d9;
    border-radius: 6px;
    font-size: 13px;
    outline: none;
  }
  .nickname-input-container input:focus {
    border-color: #1890ff;
    box-shadow: 0 0 0 2px rgba(24,144,255,0.2);
  }
  .nickname-input-container button {
    padding: 6px 10px;
    font-size: 12px;
    border-radius: 6px;
    border: none;
    cursor: pointer;
  }
  .nickname-save-btn {
    background: #1890ff;
    color: #fff;
  }
  .nickname-cancel-btn {
    background: #f5f5f5;
    color: #000000d9;
  }
```

- [ ] **Step 8: Commit**

```bash
git add source/extension/html/pannel.html
git commit -m "feat(panel): update CSS dimensions, shadows, and chat bubble styles"
```

---

## Task 2: Restructure HTML layout for better chat area

**Files:**
- Modify: `source/extension/html/pannel.html:1-268`

- [ ] **Step 1: Update Header HTML to add nickname dropdown**

Find the header section (lines 2-72) and replace the header content after the logo with:

```html
  <div id="videoTogetherHeader" class="vt-modal-header">
    <div style="display: flex;align-items: center;">
      <img style="width: 16px; height: 16px;"
        src="data:image/png;base64,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">
      <div class="vt-modal-title">VideoTogether</div>
    </div>

    <div class="nickname-dropdown" id="nicknameDropdown">
      <button class="nickname-btn" id="nicknameBtn">
        <span>👤</span>
        <span id="nicknameText">匿名用户</span>
        <span>▼</span>
      </button>
      <div class="nickname-menu" id="nicknameMenu">
        <div class="nickname-menu-item" id="editNicknameBtn">编辑昵称</div>
        <div class="nickname-menu-item" id="cancelNicknameBtn">取消</div>
      </div>
      <div class="nickname-input-container" id="nicknameInputContainer">
        <input type="text" id="nicknameInput" placeholder="输入昵称" maxlength="20" />
        <button class="nickname-save-btn" id="saveNicknameBtn">保存</button>
        <button class="nickname-cancel-btn" id="cancelNicknameEditBtn">取消</button>
      </div>
    </div>

    <button id="videoTogetherMinimize" type="button" aria-label="Minimize" class="vt-modal-close vt-modal-title-button">
      <span class="vt-modal-close-x">
        <span role="img" aria-label="minimize" class="vt-anticon vt-anticon-close vt-modal-close-icon">
          <svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" aria-hidden="true"
            role="img" class="iconify iconify--ic" width="20" height="20" preserveAspectRatio="xMidYMid meet"
            viewBox="0 0 24 24">
            <path fill="currentColor" d="M18 12.998H6a1 1 0 0 1 0-2h12a1 1 0 0 1 0 2z"></path>
          </svg>
        </span>
      </span>
    </button>

    <a href="https://setting.2gether.video/" target="_blank" id="videoTogetherSetting" type="button"
      aria-label="Setting" class="vt-modal-setting vt-modal-title-button">
      <span class="vt-modal-close-x">
        <span role="img" aria-label="Setting" class="vt-anticon vt-anticon-close vt-modal-close-icon">
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24">
            <path fill="currentColor"
              d="M24 13.616v-3.232c-1.651-.587-2.694-.752-3.219-2.019v-.001c-.527-1.271.1-2.134.847-3.707l-2.285-2.285c-1.561.742-2.433 1.375-3.707.847h-.001c-1.269-.526-1.435-1.576-2.019-3.219h-3.232c-.582 1.635-.749 2.692-2.019 3.219h-.001c-1.271.528-2.132-.098-3.707-.847l-2.285 2.285c.745 1.568 1.375 2.434.847 3.707-.527 1.271-1.584 1.438-3.219 2.02v3.232c1.632.58 2.692.749 3.219 2.019.53 1.282-.114 2.166-.847 3.707l2.285 2.286c1.562-.743 2.434-1.375 3.707-.847h.001c1.27.526 1.436 1.579 2.019 3.219h3.232c.582-1.636.75-2.69 2.027-3.222h.001c1.262-.524 2.12.101 3.698.851l2.285-2.286c-.744-1.563-1.375-2.433-.848-3.706.527-1.271 1.588-1.44 3.221-2.021zm-12 2.384c-2.209 0-4-1.791-4-4s1.791-4 4-4 4 1.791 4 4-1.791 4-4 4z" />
          </svg>
        </span>
      </span>
    </a>

    <a href="https://afdian.com/a/videotogether" target="_blank" id="vtDonate" type="button"
      class="vt-modal-donate vt-modal-title-button">
      <span class="vt-modal-close-x">
        <span role="img" class="vt-anticon vt-anticon-close vt-modal-close-icon">
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24">
            <path fill="red"
              d="M12 4.435c-1.989-5.399-12-4.597-12 3.568 0 4.068 3.06 9.481 12 14.997 8.94-5.516 12-10.929 12-14.997 0-8.118-10-8.999-12-3.568z" />
          </svg>
        </span>
      </span>
    </a>
  </div>
```

- [ ] **Step 2: Update chatHistory container for larger space**

Find the `#textMessageChat` div (lines 92-100) and update the chatHistory style:

```html
          <div id="textMessageChat" style="display: none;">
            <div id="chatHistory" style="flex: 1; min-height: 150px; max-height: 200px; overflow-y: auto; margin-bottom: 8px; text-align: left; width: 100%;"></div>
            <div style="display: flex; gap: 6px; width: 100%;">
              <input id="textMessageInput" autocomplete="off" placeholder="{$textMessageInput$}" style="flex: 1;">
              <button id="textMessageSend" class="vt-btn vt-btn-primary" type="button">
                <span>{$textMessageSend$}</span>
              </button>
            </div>
          </div>
```

- [ ] **Step 3: Update mainPannel layout for vertical stacking**

Find the `#mainPannel` div (lines 77-106) and update to:

```html
      <div id="mainPannel" class="content" style="display: flex; flex-direction: column; width: 100%; height: 100%; gap: 8px;">
        <div style="display: flex; justify-content: space-between; align-items: center;">
          <span id="videoTogetherRoleText"></span>
          <span id="memberCount"></span>
        </div>
        <div id="videoTogetherStatusText" style="color: #666; font-size: 12px;">{$global_notification$}</div>
        <div style="display: flex; flex-direction: column; gap: 4px;">
          <div style="display: flex; align-items: center; gap: 4px;">
            <span class="ellipsis" id="videoTogetherRoomNameLabel" style="width: 60px;">{$room_input_lable$}</span>
            <input id="videoTogetherRoomNameInput" autocomplete="off" placeholder="{$room_input_placeholder$}" style="flex: 1;">
          </div>
          <div style="display: flex; align-items: center; gap: 4px;">
            <span class="ellipsis" id="videoTogetherRoomPasswordLabel" style="width: 60px;">{$password_input_lable$}</span>
            <input id="videoTogetherRoomPdIpt" autocomplete="off" placeholder="{$password_input_placeholder$}" style="flex: 1;">
          </div>
        </div>
        <div style="flex: 1; min-height: 0;">
          <div id="textMessageChat" style="display: none; height: 100%;">
            <div id="chatHistory" style="flex: 1; min-height: 150px; max-height: 200px; overflow-y: auto; margin-bottom: 8px; text-align: left; width: 100%;"></div>
            <div style="display: flex; gap: 6px; width: 100%;">
              <input id="textMessageInput" autocomplete="off" placeholder="{$textMessageInput$}" style="flex: 1;">
              <button id="textMessageSend" class="vt-btn vt-btn-primary" type="button">
                <span>{$textMessageSend$}</span>
              </button>
            </div>
          </div>
          <div id="textMessageConnecting" style="display: none;">
            <span id="textMessageConnectingStatus">{$textMessageConnecting$}</span>
            <span id="zhcnTtsMissing">{$zhcnTtsMissing$}</span>
          </div>
        </div>
      </div>
```

- [ ] **Step 4: Update button group layout**

Find the lobby button group (lines 167-174) and update to:

```html
      <div id="lobbyBtnGroup" style="display: flex; gap: 8px; flex-wrap: wrap; justify-content: center;">
        <button id="videoTogetherCreateButton" class="vt-btn vt-btn-primary" type="button">
          <span>{$create_room_button$}</span>
        </button>
        <button id="videoTogetherJoinButton" class="vt-btn vt-btn-secondary" type="button">
          <span>{$join_room_button$}</span>
        </button>
      </div>
```

- [ ] **Step 5: Update room button group layout**

Find the roomButtonGroup (lines 177-224) and update to:

```html
      <div id="roomButtonGroup" style="display: none; flex-direction: column; gap: 8px;">
        <div style="display: flex; gap: 8px; justify-content: center;">
          <button id="videoTogetherExitButton" class="vt-btn vt-btn-dangerous" type="button">
            <span>{$exit_room_button$}</span>
          </button>
          <button id="callBtn" class="vt-btn vt-btn-dangerous" type="button">
            <span>{$voice_call_button$}</span>
          </button>
        </div>
        <div style="display: flex; gap: 8px; justify-content: center; align-items: center;">
          <div id="callConnecting" class="lds-ellipsis" style="display: none;">
            <div></div>
            <div></div>
            <div></div>
            <div></div>
          </div>
          <button id="callErrorBtn" class="vt-modal-title-button error-button" style="display: none;">
            <svg width="24px" height="24px" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
              <path fill="currentColor" d="M11.001 10h2v5h-2zM11 16h2v2h-2z" />
              <path fill="currentColor"
                d="M13.768 4.2C13.42 3.545 12.742 3.138 12 3.138s-1.42.407-1.768 1.063L2.894 18.064a1.986 1.986 0 0 0 .054 1.968A1.984 1.984 0 0 0 4.661 21h14.678c.708 0 1.349-.362 1.714-.968a1.989 1.989 0 0 0 .054-1.968L13.768 4.2zM4.661 19 12 5.137 19.344 19H4.661z" />
            </svg>
          </button>
          <button id="audioBtn" style="display: none;" type="button" aria-label="Close"
            class="vt-modal-audio vt-modal-title-button">
            <span class="vt-modal-close-x">
              <span class="vt-anticon vt-anticon-close vt-modal-close-icon">
                <svg width="24px" height="24px" viewBox="0 0 489.6 489.6" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path stroke="currentColor" stroke-width="16" fill="currentColor" d="M361.1,337.6c2.2,1.5,4.6,2.3,7.1,2.3c3.8,0,7.6-1.8,10-5.2c18.7-26.3,28.5-57.4,28.5-89.9s-9.9-63.6-28.5-89.9
                  c-3.9-5.5-11.6-6.8-17.1-2.9c-5.5,3.9-6.8,11.6-2.9,17.1c15.7,22.1,24,48.3,24,75.8c0,27.4-8.3,53.6-24,75.8
                  C354.3,326.1,355.6,333.7,361.1,337.6z" />
                  <path stroke="currentColor" stroke-width="16" fill="currentColor" d="M425.4,396.3c2.2,1.5,4.6,2.3,7.1,2.3c3.8,0,7.6-1.8,10-5.2c30.8-43.4,47.1-94.8,47.1-148.6s-16.3-105.1-47.1-148.6
                  c-3.9-5.5-11.6-6.8-17.1-2.9c-5.5,3.9-6.8,11.6-2.9,17.1c27.9,39.3,42.6,85.7,42.6,134.4c0,48.6-14.7,95.1-42.6,134.4
                  C418.6,384.7,419.9,392.3,425.4,396.3z" />
                  <path stroke="currentColor" stroke-width="16" fill="currentColor"
                    d="M254.7,415.7c4.3,2.5,9.2,3.8,14.2,3.8l0,0c7.4,0,14.4-2.8,19.7-7.9c5.6-5.4,8.7-12.6,8.7-20.4V98.5
                  c0-15.7-12.7-28.4-28.4-28.4c-4.9,0-9.8,1.3-14.2,3.8c-0.3,0.2-0.6,0.3-0.8,0.5l-100.1,69.2H73.3C32.9,143.6,0,176.5,0,216.9v55.6
                  c0,40.4,32.9,73.3,73.3,73.3h84.5l95.9,69.2C254,415.3,254.4,415.5,254.7,415.7z M161.8,321.3H73.3c-26.9,0-48.8-21.9-48.8-48.8
                  v-55.6c0-26.9,21.9-48.8,48.8-48.8h84.3c2.5,0,4.9-0.8,7-2.2l102.7-71c0.5-0.3,1.1-0.4,1.6-0.4c1.6,0,3.9,1.2,3.9,3.9v292.7
                  c0,1.1-0.4,2-1.1,2.8c-0.7,0.7-1.8,1.1-2.7,1.1c-0.5,0-1-0.1-1.5-0.3l-98.4-71.1C166.9,322.1,164.4,321.3,161.8,321.3z" />
                </svg>
              </span>
            </span>
          </button>
          <button id="micBtn" style="display: none;" type="button" aria-label="Close"
            class="vt-modal-mic vt-modal-title-button">
            <span class="vt-modal-close-x">
              <span class="vt-anticon vt-anticon-close vt-modal-close-icon">
                <svg width="24px" height="24px" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <rect width="48" height="48" fill="white" fill-opacity="0" />
                  <path
                    d="M31 24V11C31 7.13401 27.866 4 24 4C20.134 4 17 7.13401 17 11V24C17 27.866 20.134 31 24 31C27.866 31 31 27.866 31 24Z"
                    stroke="currentColor" stroke-width="4" stroke-linejoin="round" />
                  <path d="M9 23C9 31.2843 15.7157 38 24 38C32.2843 38 39 31.2843 39 23" stroke="currentColor"
                    stroke-width="4" stroke-linecap="round" stroke-linejoin="round" />
                  <path d="M24 38V44" stroke="currentColor" stroke-width="4" stroke-linecap="round"
                    stroke-linejoin="round" />
                  <path id="disabledMic" d="M42 42L6 6" stroke="currentColor" stroke-width="4" stroke-linecap="round"
                    stroke-linejoin="round" />
                </svg>
                <svg id="enabledMic" style="display: none;" width="24px" height="24px" viewBox="0 0 48 48" fill="none"
                  xmlns="http://www.w3.org/2000/svg">
                  <rect width="48" height="48" fill="white" fill-opacity="0" />
                  <path
                    d="M31 24V11C31 7.13401 27.866 4 24 4C20.134 4 17 7.13401 17 11V24C17 27.866 20.134 31 24 31C27.866 31 31 27.866 31 24Z"
                    stroke="currentColor" stroke-width="4" stroke-linejoin="round" />
                  <path d="M9 23C9 31.2843 15.7157 38 24 38C32.2843 38 39 31.2843 39 23" stroke="currentColor"
                    stroke-width="4" stroke-linecap="round" stroke-linejoin="round" />
                  <path d="M24 38V44" stroke="currentColor" stroke-width="4" stroke-linecap="round"
                    stroke-linejoin="round" />
                </svg>
              </span>
            </span>
          </button>
        </div>
        <button id="videoTogetherHelpButton" class="vt-btn" type="button" style="align-self: center;">
          <span>{$help_room_button$}</span>
        </button>
      </div>
```

- [ ] **Step 6: Update voice panel for consistent styling**

Find the voicePannel (lines 131-159) and update the first div to:

```html
      <div id="voicePannel" class="content" style="display: none; flex-direction: column; gap: 12px; width: 100%;">
```

- [ ] **Step 7: Commit**

```bash
git add source/extension/html/pannel.html
git commit -m "feat(panel): restructure HTML layout for better chat area and nickname dropdown"
```

---

## Task 3: Add nickname dropdown JavaScript logic in vt.js

**Files:**
- Modify: `source/extension/vt.js:1346-1450` (inside VideoTogetherFlyPannel constructor or initialization)

- [ ] **Step 1: Add nickname dropdown initialization in the initialization method or constructor**

Find the location where panel initialization happens (around line 1450, after the 500ms setTimeout block where the panel is created). Add the nickname dropdown event handlers after the panel HTML is loaded:

Add this code block after the existing panel initialization code (around line 1451):

```javascript
                        // Initialize nickname dropdown
                        const nicknameBtn = select("#nicknameBtn");
                        const nicknameMenu = select("#nicknameMenu");
                        const nicknameText = select("#nicknameText");
                        const nicknameInputContainer = select("#nicknameInputContainer");
                        const nicknameInput = select("#nicknameInput");
                        const editNicknameBtn = select("#editNicknameBtn");
                        const saveNicknameBtn = select("#saveNicknameBtn");
                        const cancelNicknameBtn = select("#cancelNicknameBtn");
                        const cancelNicknameEditBtn = select("#cancelNicknameEditBtn");

                        // Load saved nickname
                        getGM().getValue("ChatNickname").then(nickname => {
                            if (nickname) {
                                nicknameText.textContent = nickname;
                            }
                        });

                        // Toggle nickname menu
                        nicknameBtn.addEventListener("click", (e) => {
                            e.stopPropagation();
                            nicknameMenu.classList.toggle("show");
                        });

                        // Edit nickname
                        editNicknameBtn.addEventListener("click", () => {
                            nicknameMenu.classList.remove("show");
                            nicknameInputContainer.classList.add("show");
                            nicknameInput.value = nicknameText.textContent === "匿名用户" ? "" : nicknameText.textContent;
                            nicknameInput.focus();
                        });

                        // Cancel nickname menu
                        cancelNicknameBtn.addEventListener("click", () => {
                            nicknameMenu.classList.remove("show");
                        });

                        // Cancel nickname edit
                        cancelNicknameEditBtn.addEventListener("click", () => {
                            nicknameInputContainer.classList.remove("show");
                        });

                        // Save nickname
                        saveNicknameBtn.addEventListener("click", async () => {
                            const newNickname = nicknameInput.value.trim() || "匿名用户";
                            await getGM().setValue("ChatNickname", newNickname);
                            nicknameText.textContent = newNickname;
                            nicknameInputContainer.classList.remove("show");
                        });

                        // Save on Enter key
                        nicknameInput.addEventListener("keyup", (e) => {
                            if (e.key === "Enter") {
                                saveNicknameBtn.click();
                            }
                        });

                        // Close dropdown when clicking outside
                        document.addEventListener("click", (e) => {
                            if (!nicknameDropdown.contains(e.target)) {
                                nicknameMenu.classList.remove("show");
                                nicknameInputContainer.classList.remove("show");
                            }
                        });
```

- [ ] **Step 2: Commit**

```bash
git add source/extension/vt.js
git commit -m "feat(panel): add nickname dropdown JavaScript logic"
```

---

## Task 4: Verify all functionality works

- [ ] **Step 1: Test panel UI changes**

Verify the panel displays correctly with:
- New dimensions (280x420)
- Modern styling with shadows and rounded corners
- Nickname dropdown in header
- Chat area with proper scrolling
- All buttons functional

- [ ] **Step 2: Test nickname editing**

- Click nickname button to open menu
- Click "编辑昵称" to show input
- Enter new nickname and save
- Verify nickname persists after page reload

- [ ] **Step 3: Test chat functionality**

- Send a message
- Verify it appears in chat history
- Verify own messages are right-aligned
- Verify他人的消息 are left-aligned

- [ ] **Step 4: Commit final verification**

```bash
git add -A
git commit -m "feat(panel): complete panel UI modernization

- Updated dimensions to 280x420
- Added modern CSS styles with shadows and rounded corners
- Added nickname dropdown in header
- Restructured layout for larger chat area
- All functionality preserved and working"
```

---

## Spec Coverage Check

- [x] Panel size increased (280x420) - Task 1
- [x] Modern lightweight style - Task 1, 2
- [x]上下布局 with chat on top - Task 2, 3
- [x] Nickname dropdown in header - Task 2, 3
- [x] All existing functions preserved - verified in Task 4
- [x] Chat area larger - Task 2