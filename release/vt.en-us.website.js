// ==UserScript==
// @name         Video Together 一起看视频
// @namespace    https://2gether.video/
// @version      1777046977
// @description  Watch video together 一起看视频
// @author       maggch@outlook.com
// @match        *://*/*
// @icon         https://2gether.video/icon/favicon-32x32.png
// @grant        none
// ==/UserScript==

(function () {
    try {
        // this attribute will break the cloudflare turnstile
        document.currentScript.removeAttribute("cachedvt")
        document.currentScript.remove()
    } catch { }
    const language = 'en-us'
    const vtRuntime = `website`;
    const realUrlCache = {}
    const m3u8ContentCache = {}

    const Var = {
        isThisMemberLoading: false,
        cdnConfig: undefined,
    }

    let inDownload = false;
    let isDownloading = false;

    let roomUuid = null;

    const lastRunQueue = []
    // request can only be called up to 10 times in 5 seconds
    const periodSec = 5;
    const timeLimitation = 15;
    const textVoiceAudio = document.createElement('audio');

    const encodedChinaCdnA = 'https://videotogether.oss-cn-hangzhou.aliyuncs.com'
    function getCdnPath(encodedCdn, path) {
        const cdn = encodedCdn.startsWith('https') ? encodedCdn : atob(encodedCdn);
        return `${cdn}/${path}`;
    }
    async function getCdnConfig(encodedCdn) {
        if (Var.cdnConfig != undefined) {
            return Var.cdnConfig;
        }
        return extension.Fetch(getCdnPath(encodedCdn, 'release/cdn-config.json')).then(r => r.json()).then(config => Var.cdnConfig = config).then(() => Var.cdnConfig)
    }
    async function getEasyShareHostChina() {
        return getCdnConfig(encodedChinaCdnA).then(c => c.easyShareHostChina)
    }
    async function getApiHostChina() {
        const encodedHost = await getCdnConfig(encodedChinaCdnA).then(c => c.apiHostChina)
        return encodedHost.startsWith('https') ? encodedHost : atob(encodedHost);
    }

    let trustedPolicy = undefined;
    function updateInnnerHTML(e, html) {
        try {
            e.innerHTML = html;
        } catch {
            if (trustedPolicy == undefined) {
                trustedPolicy = trustedTypes.createPolicy('videoTogetherExtensionVtJsPolicy', {
                    createHTML: (string) => string,
                    createScript: (string) => string,
                    createScriptURL: (url) => url
                });
            }
            e.innerHTML = trustedPolicy.createHTML(html);
        }
    }

    function getDurationStr(duration) {
        try {
            let d = parseInt(duration);
            let str = ""
            let units = [" Sec ", " Min ", " Hr "]
            for (let i in units) {
                if (d > 0) {
                    str = d % 60 + units[i] + str;
                }
                d = Math.floor(d / 60)
            }
            return str;
        } catch {
            return "N/A"
        }
    }

    function downloadEnabled() {
        try {
            if (window.VideoTogetherDownload == 'disabled') {
                return false;
            }
            const type = VideoTogetherStorage.UserscriptType
            return parseInt(window.VideoTogetherStorage.LoaddingVersion) >= 1694758378
                && (type == "Chrome" || type == "Safari" || type == "Firefox")
                && !isDownloadBlackListDomain()
        } catch {
            return false;
        }
    }

    function isM3U8(textContent) {
        return textContent.trim().startsWith('#EXTM3U');
    }
    function isMasterM3u8(textContent) {
        return textContent.includes('#EXT-X-STREAM-INF:');
    }

    function getFirstMediaM3U8(m3u8Content, m3u8Url) {
        if (!isMasterM3u8(m3u8Content)) {
            return null;
        }
        const lines = m3u8Content.split('\n');

        for (const line of lines) {
            const trimmedLine = line.trim();
            if (trimmedLine && !trimmedLine.startsWith('#') && trimmedLine != "") {
                return new URL(trimmedLine, m3u8Url);
            }
        }
        return null;
    }

    function startDownload(_vtArgM3u8Url, _vtArgM3u8Content, _vtArgM3u8Urls, _vtArgTitle, _vtArgPageUrl) {
        /*//*/
(async function () {

    function extractExtXKeyUrls(m3u8Content, baseUrl) {
        const uris = [];
        const lines = m3u8Content.split('\n');

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i].trim();

            if (line.startsWith('#EXT-X-')) {
                const match = line.match(/URI="(.*?)"/);

                if (match && match[1]) {
                    let uri = match[1];

                    // Ignore data: URIs as they don't need to be downloaded
                    if (uri.startsWith('data:')) {
                        continue;
                    }

                    // If the URI is not absolute, make it so by combining with the base URL.
                    if (!uri.startsWith('http://') && !uri.startsWith('https://')) {
                        uri = new URL(uri, baseUrl).href;
                    }

                    uris.push(uri);
                }
            }
        }

        return uris;
    }

    async function timeoutAsyncRead(reader, timeout) {
        const timer = new Promise((_, rej) => {
            const id = setTimeout(() => {
                reader.cancel();
                rej(new Error('Stream read timed out'));
            }, timeout);
        });

        return Promise.race([
            reader.read(),
            timer
        ]);
    }

    function generateUUID() {
        if (crypto.randomUUID != undefined) {
            return crypto.randomUUID();
        }
        return ([1e7] + -1e3 + -4e3 + -8e3 + -1e11).replace(/[018]/g, c =>
            (c ^ crypto.getRandomValues(new Uint8Array(1))[0] & 15 >> c / 4).toString(16)
        );
    }

    window.updateM3u8Status = async function updateM3u8Status(m3u8Url, status) {
        // 0 downloading  1 completed 2 deleting
        let m3u8mini = await readFromIndexedDB('m3u8s-mini', m3u8Url);
        m3u8mini.status = status
        await saveToIndexedDB('m3u8s-mini', m3u8Url, m3u8mini);
    }

    async function saveM3u8(m3u8Url, m3u8Content) {
        await saveToIndexedDB('m3u8s', m3u8Url,
            {
                data: m3u8Content,
                title: vtArgTitle,
                pageUrl: vtArgPageUrl,
                m3u8Url: m3u8Url,
                m3u8Id: m3u8Id,
                status: 0
            }
        )

    }

    async function blobToDataUrl(blob) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = function (event) {
                resolve(event.target.result);
            };
            reader.onerror = function (event) {
                reject(new Error("Failed to read blob"));
            };
            reader.readAsDataURL(blob);
        });
    }

    async function saveBlob(table, url, blob) {
        return new Promise(async (res, rej) => {
            try {
                const dataUrl = await blobToDataUrl(blob);
                await saveToIndexedDB(table, url, {
                    data: dataUrl,
                    m3u8Url: downloadM3u8Url,
                    m3u8Id: m3u8Id,
                })
                res();
            } catch (e) {
                rej(e);
            }
        })
    }

    window.regexMatchKeys = function regexMatchKeys(table, regex) {
        const queryId = generateUUID()
        return new Promise((res, rej) => {
            window.postMessage({
                source: "VideoTogether",
                type: 2005,
                data: {
                    table: table,
                    regex: regex,
                    id: queryId
                }
            }, '*')
            regexCallback[queryId] = (data) => {
                try {
                    res(data)
                } catch { rej() }
            }
        })
    }

    saveToIndexedDBThreads = 1;
    window.saveToIndexedDB = async function saveToIndexedDB(table, key, data) {
        while (saveToIndexedDBThreads < 1) {
            await new Promise(r => setTimeout(r, 100));
        }
        saveToIndexedDBThreads--;
        const queryId = generateUUID();
        return new Promise((res, rej) => {
            data.saveTime = Date.now()
            window.postMessage({
                source: "VideoTogether",
                type: 2001,
                data: {
                    table: table,
                    key: key,
                    data: data,
                    id: queryId,
                }
            }, '*')
            data = null;
            saveCallback[queryId] = (error) => {
                saveToIndexedDBThreads++;
                if (error === 0) {
                    res(0)
                } else {
                    rej(error)
                }
            }
        })
    }

    window.iosDeleteByPrefix = async function iosDeleteByPrefix(prefix) {
        const queryId = generateUUID();
        return new Promise((res, rej) => {
            window.postMessage({
                source: "VideoTogether",
                type: 3010,
                data: {
                    prefix: prefix,
                    id: queryId,
                }
            }, '*')
            deleteByPrefix[queryId] = (error) => {
                if (error === 0) {
                    res(0)
                } else {
                    rej(error)
                }
            }
        })
    }

    let readCallback = {}
    let regexCallback = {}
    let deleteCallback = {}
    let saveCallback = {}
    let deleteByPrefix = {}

    window.addEventListener('message', async e => {
        if (e.data.source == "VideoTogether") {
            switch (e.data.type) {
                case 2003: {
                    saveCallback[e.data.data.id](e.data.data.error)
                    saveCallback[e.data.data.id] = undefined
                    break;
                }
                case 2004: {
                    readCallback[e.data.data.id](e.data.data.data)
                    readCallback[e.data.data.id] = undefined;
                    break;
                }
                case 2006: {
                    regexCallback[e.data.data.id](e.data.data.data)
                    regexCallback[e.data.data.id] = undefined;
                    break;
                }
                case 2008: {
                    deleteCallback[e.data.data.id](e.data.data.error);
                    deleteCallback[e.data.data.id] = undefined;
                    break;
                }
                case 3011: {
                    deleteByPrefix[e.data.data.id](e.data.data.error);
                    deleteByPrefix[e.data.data.id] = undefined;
                    break;
                }
                case 2010: {
                    console.log(e.data.data.data);
                    break;
                }
            }
        }
    })
    window.requestStorageEstimate = function requestStorageEstimate() {
        window.postMessage({
            source: "VideoTogether",
            type: 2009,
            data: {}
        }, '*')
    }
    window.deleteFromIndexedDB = function deleteFromIndexedDB(table, key) {
        const queryId = generateUUID()
        window.postMessage({
            source: "VideoTogether",
            type: 2007,
            data: {
                id: queryId,
                table: table,
                key: key,
            }
        }, '*')
        return new Promise((res, rej) => {
            deleteCallback[queryId] = (error) => {
                if (error === 0) {
                    res(true);
                } else {
                    rej(error);
                }
            }
        })
    }

    window.readFromIndexedDB = function readFromIndexedDB(table, key) {
        const queryId = generateUUID();

        window.postMessage({
            source: "VideoTogether",
            type: 2002,
            data: {
                table: table,
                key: key,
                id: queryId,
            }
        }, '*')
        return new Promise((res, rej) => {
            readCallback[queryId] = (data) => {
                try {
                    res(data);
                } catch {
                    rej()
                }
            }
        })
    }

    if (window.videoTogetherExtension === undefined) {
        return;
    }
    if (window.location.hostname == 'local.2gether.video') {
        return;
    }
    let vtArgM3u8Url = undefined;
    let vtArgM3u8Content = undefined;
    let vtArgM3u8Urls = undefined;
    let vtArgTitle = undefined;
    let vtArgPageUrl = undefined;
    try {
        vtArgM3u8Url = _vtArgM3u8Url;
        vtArgM3u8Content = _vtArgM3u8Content;
        vtArgM3u8Urls = _vtArgM3u8Urls;
        vtArgTitle = _vtArgTitle;
        vtArgPageUrl = _vtArgPageUrl;
    } catch {
        return;
    }

    const m3u8Id = generateUUID()
    const m3u8IdHead = `-m3u8Id-${m3u8Id}-end-`
    const downloadM3u8Url = vtArgM3u8Url;
    const numThreads = 10;
    let lastTotalBytes = 0;
    let totalBytes = 0;
    let failedUrls = []
    let urls = vtArgM3u8Urls
    let successCount = 0;
    videoTogetherExtension.downloadPercentage = 0;

    const m3u8Key = m3u8IdHead + downloadM3u8Url
    if (downloadM3u8Url === undefined) {
        return;
    }

    await saveM3u8(m3u8Key, vtArgM3u8Content)

    const otherUrl = extractExtXKeyUrls(vtArgM3u8Content, downloadM3u8Url);
    const totalCount = urls.length + otherUrl.length;

    console.log(otherUrl);

    await downloadInParallel('future', otherUrl, numThreads);

    setInterval(function () {
        videoTogetherExtension.downloadSpeedMb = (totalBytes - lastTotalBytes) / 1024 / 1024;
        lastTotalBytes = totalBytes;
    }, 1000);

    await downloadInParallel('videos', urls, numThreads);
    await updateM3u8Status(m3u8Key, 1)
    async function fetchWithSpeedTracking(url) {
        const controller = new AbortController();
        const timer = setTimeout(() => {
            controller.abort();
        }, 20000);

        const response = await fetch(url, { signal: controller.signal });
        clearTimeout(timer)
        if (!response.body) {
            throw new Error("ReadableStream not yet supported in this browser.");
        }

        const contentType = response.headers.get("Content-Type") || "application/octet-stream";

        const reader = response.body.getReader();
        let chunks = [];

        async function readStream() {
            const { done, value } = await timeoutAsyncRead(reader, 60000);
            if (done) {
                return;
            }

            if (value) {
                chunks.push(value);
                totalBytes += value.length;
            }

            // Continue reading the stream
            return await readStream();
        }
        await readStream();
        const blob = new Blob(chunks, { type: contentType });
        chunks = null;
        return blob;
    }

    async function downloadWorker(table, urls, index, step, total) {
        if (index >= total) {
            return;
        }

        const url = urls[index];
        try {
            let blob = await fetchWithSpeedTracking(url);
            await saveBlob(table, m3u8IdHead + url, blob);
            blob = null;
            successCount++;
            videoTogetherExtension.downloadPercentage = Math.floor((successCount / totalCount) * 100)
            console.log('download ts:', table, index, 'of', total);
        } catch (e) {
            await new Promise(r => setTimeout(r, 2000));
            failedUrls.push(url);
            console.error(e);
        }

        // Pick up the next work item
        await downloadWorker(table, urls, index + step, step, total);
    }

    async function downloadInParallel(table, urls, numThreads) {
        const total = urls.length;

        // Start numThreads download workers
        const promises = Array.from({ length: numThreads }, (_, i) => {
            return downloadWorker(table, urls, i, numThreads, total);
        });

        await Promise.all(promises);
        if (failedUrls.length != 0) {
            urls = failedUrls;
            failedUrls = [];
            await downloadInParallel(table, urls, numThreads);
        }
    }
})()
//*/
    }

    function isLimited() {
        while (lastRunQueue.length > 0 && lastRunQueue[0] < Date.now() / 1000 - periodSec) {
            lastRunQueue.shift();
        }
        if (lastRunQueue.length > timeLimitation) {
            console.error("limited")
            return true;
        }
        lastRunQueue.push(Date.now() / 1000);
        return false;
    }

    function getVideoTogetherStorage(key, defaultVal) {
        try {
            if (window.VideoTogetherStorage == undefined) {
                return defaultVal
            } else {
                if (window.VideoTogetherStorage[key] == undefined) {
                    return defaultVal
                } else {
                    return window.VideoTogetherStorage[key];
                }
            }
        } catch { return defaultVal }
    }

    function getEnableTextMessage() {
        return getVideoTogetherStorage('EnableTextMessage', true);
    }

    function getEnableMiniBar() {
        return getVideoTogetherStorage('EnableMiniBar', true);
    }

    function skipIntroLen() {
        try {
            let len = parseInt(window.VideoTogetherStorage.SkipIntroLength);
            if (window.VideoTogetherStorage.SkipIntro && !isNaN(len)) {
                return len;
            }
        } catch { }
        return 0;
    }

    function isEmpty(s) {
        try {
            return s.length == 0;
        } catch {
            return true;
        }
    }

    function emptyStrIfUdf(s) {
        return s == undefined ? "" : s;
    }

    let isDownloadBlackListDomainCache = undefined;
    function isDownloadBlackListDomain() {
        if (window.location.protocol != 'http:' && window.location.protocol != 'https:') {
            return true;
        }
        const domains = [
            'iqiyi.com', 'qq.com', 'youku.com',
            'bilibili.com', 'baidu.com', 'quark.cn',
            'aliyundrive.com', "115.com", "acfun.cn", "youtube.com",
        ];
        if (isDownloadBlackListDomainCache == undefined) {
            const hostname = window.location.hostname;
            isDownloadBlackListDomainCache = domains.some(domain => hostname === domain || hostname.endsWith(`.${domain}`));
        }
        return isDownloadBlackListDomainCache;
    }

    let isEasyShareBlackListDomainCache = undefined;
    function isEasyShareBlackListDomain() {
        if (window.location.protocol != 'https:') {
            return true;
        }
        const domains = [
            'iqiyi.com', 'qq.com', 'youku.com',
            'bilibili.com', 'baidu.com', 'quark.cn',
            'aliyundrive.com', "115.com", "pornhub.com", "acfun.cn", "youtube.com",
            // --
            "missav.com", "nivod4.tv"
        ];
        if (isEasyShareBlackListDomainCache == undefined) {
            const hostname = window.location.hostname;
            isEasyShareBlackListDomainCache = domains.some(domain => hostname === domain || hostname.endsWith(`.${domain}`));
        }
        return isEasyShareBlackListDomainCache;
    }

    function isEasyShareEnabled() {
        if (inDownload) {
            return false;
        }
        try {
            if (isWeb()) {
                return false;
            }
            if (isEasyShareBlackListDomain()) {
                return false;
            }
            return window.VideoTogetherEasyShare != 'disabled' && window.VideoTogetherStorage.EasyShare != false;
        } catch {
            return false;
        }
    }

    function isEasyShareMember() {
        try {
            return window.VideoTogetherEasyShareMemberSite == true;
        } catch {
            return false;
        }
    }

    function useMobileStyle(videoDom) {
        let isMobile = false;
        if (window.location.href.startsWith('https://m.bilibili.com/')) {
            isMobile = true;
        }
        if (!isMobile) {
            return;
        }
        document.body.childNodes.forEach(e => {
            try {
                if (e != videoDom && e.style && e.id != 'VideoTogetherWrapper') {
                    e.style.display = 'none'
                }
            } catch { }

        });
        videoDom.setAttribute('controls', true);
        videoDom.style.width = videoDom.style.height = "100%";
        videoDom.style.maxWidth = videoDom.style.maxHeight = "100%";
        videoDom.style.display = 'block';
        if (videoDom.parentElement != document.body) {
            document.body.appendChild(videoDom);
        }
    }

    const mediaUrlsCache = {}
    function extractMediaUrls(m3u8Content, m3u8Url) {
        if (mediaUrlsCache[m3u8Url] == undefined) {
            let lines = m3u8Content.split("\n");
            let mediaUrls = [];
            let base = undefined;
            try {
                base = new URL(m3u8Url);
            } catch { };
            for (let i = 0; i < lines.length; i++) {
                let line = lines[i].trim();
                if (line !== "" && !line.startsWith("#")) {
                    let mediaUrl = new URL(line, base);
                    mediaUrls.push(mediaUrl.href);
                }
            }
            mediaUrlsCache[m3u8Url] = mediaUrls;
        }
        return mediaUrlsCache[m3u8Url];
    }

    function fixedEncodeURIComponent(str) {
        return encodeURIComponent(str).replace(
            /[!'()*]/g,
            (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`
        ).replace(/%20/g, '+');
    }

    function fixedDecodeURIComponent(str) {
        return decodeURIComponent(str.replace(/\+/g, ' '));
    }

    function isWeb() {
        try {
            let type = window.VideoTogetherStorage.UserscriptType;
            return type == 'website' || type == 'website_debug';
        } catch {
            return false;
        }
    }

    /**
     * @returns {Element}
     */
    function select(query) {
        let e = window.videoTogetherFlyPannel.wrapper.querySelector(query);
        return e;
    }

    function hide(e) {
        if (e) e.style.display = 'none';
    }

    function show(e) {
        if (e) e.style.display = null;
    }

    function isVideoLoadded(video) {
        try {
            if (isNaN(video.readyState)) {
                return true;
            }
            return video.readyState >= 3;
        } catch {
            return true;
        }
    }

    function isRoomProtected() {
        try {
            return window.VideoTogetherStorage == undefined || window.VideoTogetherStorage.PasswordProtectedRoom != false;
        } catch {
            return true;
        }
    }

    function changeBackground(url) {
        let e = select('.vt-modal-body');
        if (e) {
            if (url == null || url == "") {
                e.style.backgroundImage = 'none';
            } else if (e.style.backgroundImage != `url("${url}")`) {
                e.style.backgroundImage = `url("${url}")`
            }
        }
    }

    function changeMemberCount(c) {
        extension.ctxMemberCount = c;
        updateInnnerHTML(select('#memberCount'), String.fromCodePoint("0x1f465") + " " + c)
    }

    function dsply(e, _show = true) {
        _show ? show(e) : hide(e);
    }

    async function isAudioVolumeRO() {
        let a = new Audio();
        a.volume = 0.5;
        return new Promise(r => setTimeout(() => {
            r(!(a.volume == 0.5))
        }, 1));
    }

    const Global = {
        inited: false,
        NativePostMessageFunction: null,
        NativeAttachShadow: null,
        NativeFetch: null
    }

    function AttachShadow(e, options) {
        try {
            return e.attachShadow(options);
        } catch (err) {
            GetNativeFunction();
            return Global.NativeAttachShadow.call(e, options);
        }
    }

    function GetNativeFunction() {
        if (Global.inited) {
            return;
        }
        Global.inited = true;
        let temp = document.createElement("iframe");
        hide(temp);
        document.body.append(temp);
        Global.NativePostMessageFunction = temp.contentWindow.postMessage;
        Global.NativeAttachShadow = temp.contentWindow.Element.prototype.attachShadow;
        Global.NativeFetch = temp.contentWindow.fetch;
        temp.remove();
    }

    function PostMessage(window, data) {
        if (/\{\s+\[native code\]/.test(Function.prototype.toString.call(window.postMessage))) {
            window.postMessage(data, "*");
        } else {
            GetNativeFunction();
            Global.NativePostMessageFunction.call(window, data, "*");
        }
    }

    async function Fetch(url, init) {
        if (/\{\s+\[native code\]/.test(Function.prototype.toString.call(window.fetch))) {
            return await fetch(url, init);
        } else {
            GetNativeFunction();
            return await Global.NativeFetch.call(window, url, init);
        }
    }

    function sendMessageToTop(type, data) {
        PostMessage(window.top, {
            source: "VideoTogether",
            type: type,
            data: data
        });
    }

    function sendMessageToSelf(type, data) {
        PostMessage(window, {
            source: "VideoTogether",
            type: type,
            data: data
        });
    }

    function sendMessageTo(w, type, data) {
        PostMessage(w, {
            source: "VideoTogether",
            type: type,
            data: data
        });
    }

    function initRangeSlider(slider) {
        const min = slider.min
        const max = slider.max
        const value = slider.value

        slider.style.background = `linear-gradient(to right, #1abc9c 0%, #1abc9c ${(value - min) / (max - min) * 100}%, #d7dcdf ${(value - min) / (max - min) * 100}%, #d7dcdf 100%)`

        slider.addEventListener('input', function () {
            this.style.background = `linear-gradient(to right, #1abc9c 0%, #1abc9c ${(this.value - this.min) / (this.max - this.min) * 100}%, #d7dcdf ${(this.value - this.min) / (this.max - this.min) * 100}%, #d7dcdf 100%)`
        });
    }

    function WSUpdateRoomRequest(name, password, url, playbackRate, currentTime, paused, duration, localTimestamp, m3u8Url) {
        return {
            "method": "/room/update",
            "data": {
                "tempUser": extension.tempUser,
                "password": password,
                "name": name,
                "playbackRate": playbackRate,
                "currentTime": currentTime,
                "paused": paused,
                "url": url,
                "lastUpdateClientTime": localTimestamp,
                "duration": duration,
                "protected": isRoomProtected(),
                "videoTitle": extension.isMain ? document.title : extension.videoTitle,
                "sendLocalTimestamp": Date.now() / 1000,
                "m3u8Url": m3u8Url
            }
        }
    }

    function WSJoinRoomRequest(name, password) {
        return {
            "method": "/room/join",
            "data": {
                "password": password,
                "name": name,
            }
        }
    }

    function WsUpdateMemberRequest(name, password, isLoadding, currentUrl) {
        return {
            "method": "/room/update_member",
            "data": {
                "password": password,
                "roomName": name,
                "sendLocalTimestamp": Date.now() / 1000,
                "userId": extension.tempUser,
                "isLoadding": isLoadding,
                "currentUrl": currentUrl
            }
        }
    }

    function popupError(msg) {
        let x = select("#snackbar");
        updateInnnerHTML(x, msg);
        x.className = "show";
        setTimeout(function () { x.className = x.className.replace("show", ""); }, 3000);
        let changeVoiceBtn = select('#changeVoiceBtn');
        if (changeVoiceBtn != undefined) {
            changeVoiceBtn.onclick = () => {
                windowPannel.ShowTxtMsgTouchPannel();
            }
        }
    }

    async function waitForRoomUuid(timeout = 10000) {
        return new Promise((res, rej) => {
            let id = setInterval(() => {
                if (roomUuid != null) {
                    res(roomUuid);
                    clearInterval(id);
                }
            }, 200)
            setTimeout(() => {
                clearInterval(id);
                rej(null);
            }, timeout);
        });
    }

    class Room {
        constructor() {
            this.currentTime = null;
            this.duration = null;
            this.lastUpdateClientTime = null;
            this.lastUpdateServerTime = null;
            this.name = null;
            this.paused = null;
            this.playbackRate = null;
            this.protected = null;
            this.timestamp = null;
            this.url = null;
            this.videoTitle = null;
            this.waitForLoadding = null;
        }
    }

    const WS = {
        _socket: null,
        _lastConnectTime: 0,
        _connectTimeout: 10,
        _expriedTime: 5,
        _lastUpdateTime: 0,
        _lastErrorMessage: null,
        _lastRoom: new Room(),
        _connectedToService: false,
        isOpen() {
            try {
                return this._socket.readyState = 1 && this._connectedToService;
            } catch { return false; }
        },
        async connect() {
            if (this._socket != null) {
                try {
                    if (this._socket.readyState == 1) {
                        return;
                    }
                    if (this._socket.readyState == 0
                        && this._lastConnectTime + this._connectTimeout > Date.now() / 1000) {
                        return;
                    }
                } catch { }
            }
            console.log('ws connect');
            this._lastConnectTime = Date.now() / 1000
            this._connectedToService = false;
            try {
                this.disconnect()
                this._socket = new WebSocket(`wss://${extension.video_together_host.replace("https://", "")}/ws?language=${language}`);
                this._socket.onmessage = async e => {
                    let lines = e.data.split('\n');
                    for (let i = 0; i < lines.length; i++) {
                        try {
                            await this.onmessage(lines[i]);
                        } catch (err) { console.log(err, lines[i]) }
                    }
                }
            } catch { }
        },
        async onmessage(str) {
            data = JSON.parse(str);
            if (data['errorMessage'] != null) {
                this._lastUpdateTime = Date.now() / 1000;
                this._lastErrorMessage = data['errorMessage'];
                this._lastRoom = null;
                return;
            }
            this._lastErrorMessage = null;
            if (data['method'] == "/room/join") {
                this._joinedName = data['data']['name'];
            }
            if (data['method'] == "/room/join" || data['method'] == "/room/update" || data['method'] == "/room/update_member") {
                this._connectedToService = true;
                this._lastRoom = Object.assign(data['data'], Room);
                this._lastUpdateTime = Date.now() / 1000;

                if (extension.role == extension.RoleEnum.Member) {
                    if (!isLimited()) {
                        extension.ScheduledTask();
                    }
                }
                if (extension.role == extension.RoleEnum.Master && data['method'] == "/room/update_member") {
                    if (!isLimited()) {
                        extension.setWaitForLoadding(this._lastRoom.waitForLoadding);
                        extension.ScheduledTask();
                    }
                }
            }
            if (data['method'] == 'replay_timestamp') {
                sendMessageToTop(MessageType.TimestampV2Resp, { ts: Date.now() / 1000, data: data['data'] })
            }
            if (data['method'] == 'url_req') {
                extension.UrlRequest(data['data'].m3u8Url, data['data'].idx, data['data'].origin)
            }
            if (data['method'] == 'url_resp') {
                realUrlCache[data['data'].origin] = data['data'].real;
            }
            if (data['method'] == 'm3u8_req') {
                content = extension.GetM3u8Content(data['data'].m3u8Url);
                WS.m3u8ContentResp(data['data'].m3u8Url, content);
            }
            if (data['method'] == 'm3u8_resp') {
                m3u8ContentCache[data['data'].m3u8Url] = data['data'].content;
            }
            if (data['method'] == 'send_txtmsg' && getEnableTextMessage()) {
                const isSelf = data['data'].id == extension.currentSendingMsgId;
                if (!isSelf) {
                    popupError("VideoTogether: New Messages (<a id='changeVoiceBtn' style='color:inherit' href='#''>Change Voice</a>)");
                }
                sendMessageToTop(MessageType.GotTxtMsg, { id: data['data'].id, msg: data['data'].msg });
            }
        },
        getRoom() {
            if (this._lastUpdateTime + this._expriedTime > Date.now() / 1000) {
                if (this._lastErrorMessage != null) {
                    throw new Error(this._lastErrorMessage);
                }
                return this._lastRoom;
            }
        },
        async send(data) {
            try {
                this._socket.send(JSON.stringify(data));
            } catch { }
        },
        async updateRoom(name, password, url, playbackRate, currentTime, paused, duration, localTimestamp, m3u8Url) {
            // TODO localtimestamp
            this.send(WSUpdateRoomRequest(name, password, url, playbackRate, currentTime, paused, duration, localTimestamp, m3u8Url));
        },
        async urlReq(m3u8Url, idx, origin) {
            this.send({
                "method": "url_req",
                "data": {
                    "m3u8Url": m3u8Url,
                    "idx": idx,
                    "origin": origin
                }
            })
        },
        async urlResp(origin, real) {
            this.send({
                "method": "url_resp",
                "data": {
                    "origin": origin,
                    "real": real,
                }
            })
        },
        async m3u8ContentReq(m3u8Url) {
            this.send({
                "method": "m3u8_req",
                "data": {
                    "m3u8Url": m3u8Url,
                }
            })
        },
        async sendTextMessage(id, msg) {
            this.send({
                "method": "send_txtmsg",
                "data": {
                    "msg": msg,
                    "id": id,
                    "voiceId": getVideoTogetherStorage('PublicReechoVoiceId', "")
                }
            })
        },
        async m3u8ContentResp(m3u8Url, content) {
            this.send({
                "method": "m3u8_resp",
                "data": {
                    "m3u8Url": m3u8Url,
                    "content": content
                }
            })
        },
        async updateMember(name, password, isLoadding, currentUrl) {
            this.send(WsUpdateMemberRequest(name, password, isLoadding, currentUrl));
        },
        _joinedName: null,
        async joinRoom(name, password) {
            if (name == this._joinedName) {
                return;
            }
            this.send(WSJoinRoomRequest(name, password));
        },
        async disconnect() {
            if (this._socket != null) {
                try {
                    this._socket.close();
                } catch { }
            }
            this._joinedName = null;
            this._socket = null;
        }
    }

    const VoiceStatus = {
        STOP: 1,
        CONNECTTING: 5,
        MUTED: 2,
        UNMUTED: 3,
        ERROR: 4
    }

    const Voice = {
        _status: VoiceStatus.STOP,
        _errorMessage: "",
        _rname: "",
        _mutting: false,
        get errorMessage() {
            return this._errorMessage;
        },
        set errorMessage(m) {
            this._errorMessage = m;
            updateInnnerHTML(select("#snackbar"), m);
            let voiceConnErrBtn = select('#voiceConnErrBtn');
            if (voiceConnErrBtn != undefined) {
                voiceConnErrBtn.onclick = () => {
                    alert('If you have installed uBlock and other adblock extensions, please disable those extensions and try again.')
                }
            }
        },
        set status(s) {
            this._status = s;
            let micBtn = select('#micBtn');
            let audioBtn = select('#audioBtn');
            let callBtn = select("#callBtn");
            let callConnecting = select("#callConnecting");
            let callErrorBtn = select("#callErrorBtn");
            dsply(callConnecting, s == VoiceStatus.CONNECTTING);
            dsply(callBtn, s == VoiceStatus.STOP);
            let inCall = (VoiceStatus.UNMUTED == s || VoiceStatus.MUTED == s);
            dsply(micBtn, inCall);
            dsply(audioBtn, inCall);
            dsply(callErrorBtn, s == VoiceStatus.ERROR);
            switch (s) {
                case VoiceStatus.STOP:
                    break;
                case VoiceStatus.MUTED:
                    micBtn.classList.add('muted');
                    break;
                case VoiceStatus.UNMUTED:
                    micBtn.classList.remove('muted');
                    break;
                case VoiceStatus.ERROR:
                    var x = select("#snackbar");
                    x.className = "show";
                    setTimeout(function () { x.className = x.className.replace("show", ""); }, 3000);
                    break;
                default:
                    break;
            }
        },
        get status() {
            return this._status;
        },
        _conn: null,
        set conn(conn) {
            this._conn = conn;
        },
        /**
         * @return {RTCPeerConnection}
         */
        get conn() {
            return this._conn
        },

        _stream: null,
        set stream(s) {
            this._stream = s;
        },
        /**
         * @return {MediaStream}
         */
        get stream() {
            return this._stream;
        },

        _noiseCancellationEnabled: true,
        set noiseCancellationEnabled(n) {
            this._noiseCancellationEnabled = n;
            if (this.inCall) {
                this.updateVoiceSetting(n);
            }
        },

        get noiseCancellationEnabled() {
            return this._noiseCancellationEnabled;
        },

        get inCall() {
            return this.status == VoiceStatus.MUTED || this.status == VoiceStatus.UNMUTED;
        },

        join: async function (name, rname, mutting = false) {
            Voice._rname = rname;
            Voice._mutting = mutting;
            let cancellingNoise = true;
            try {
                cancellingNoise = !(window.VideoTogetherStorage.EchoCancellation === false);
            } catch { }

            Voice.stop();
            Voice.status = VoiceStatus.CONNECTTING;
            this.noiseCancellationEnabled = cancellingNoise;
            let uid = generateUUID();
            let notNullUuid;
            try {
                notNullUuid = await waitForRoomUuid();
            } catch {
                Voice.errorMessage = "uuid is missing";
                Voice.status = VoiceStatus.ERROR;
                return;
            }
            const rnameRPC = fixedEncodeURIComponent(notNullUuid + "_" + rname);
            if (rnameRPC.length > 256) {
                Voice.errorMessage = "Room name too long";
                Voice.status = VoiceStatus.ERROR;
                return;
            }
            if (window.location.protocol != "https:" && window.location.protocol != 'file:') {
                Voice.errorMessage = "Only support https website";
                Voice.status = VoiceStatus.ERROR;
                return;
            }
            const unameRPC = fixedEncodeURIComponent(uid + ':' + Base64.encode(generateUUID()));
            let ucid = "";
            console.log(rnameRPC, uid);
            const configuration = {
                bundlePolicy: 'max-bundle',
                rtcpMuxPolicy: 'require',
                sdpSemantics: 'unified-plan'
            };

            async function subscribe(pc) {
                var res = await rpc('subscribe', [rnameRPC, unameRPC, ucid]);
                if (res.error && typeof res.error === 'object' && typeof res.error.code === 'number' && [5002001, 5002002].indexOf(res.error.code) != -1) {
                    Voice.join("", Voice._rname, Voice._mutting);
                    return;
                }
                if (res.data) {
                    var jsep = JSON.parse(res.data.jsep);
                    if (jsep.type == 'offer') {
                        await pc.setRemoteDescription(jsep);
                        var sdp = await pc.createAnswer();
                        await pc.setLocalDescription(sdp);
                        await rpc('answer', [rnameRPC, unameRPC, ucid, JSON.stringify(sdp)]);
                    }
                }
                setTimeout(function () {
                    if (Voice.conn != null && pc === Voice.conn && Voice.status != VoiceStatus.STOP) {
                        subscribe(pc);
                    }
                }, 3000);
            }


            try {
                await start();
            } catch (e) {
                if (Voice.status == VoiceStatus.CONNECTTING) {
                    Voice.status = VoiceStatus.ERROR;
                    Voice.errorMessage = "Connection error (<a id='voiceConnErrBtn' style='color:inherit' href='#''>Help</a>)";
                }
            }

            if (Voice.status == VoiceStatus.CONNECTTING) {
                Voice.status = mutting ? VoiceStatus.MUTED : VoiceStatus.UNMUTED;
            }

            async function start() {

                let res = await rpc('turn', [unameRPC]);
                if (res.data && res.data.length > 0) {
                    configuration.iceServers = res.data;
                    configuration.iceTransportPolicy = 'relay';
                }

                Voice.conn = new RTCPeerConnection(configuration);

                Voice.conn.onicecandidate = ({ candidate }) => {
                    rpc('trickle', [rnameRPC, unameRPC, ucid, JSON.stringify(candidate)]);
                };

                Voice.conn.ontrack = (event) => {
                    console.log("ontrack", event);

                    let stream = event.streams[0];
                    let sid = fixedDecodeURIComponent(stream.id);
                    let id = sid.split(':')[0];
                    // var name = Base64.decode(sid.split(':')[1]);
                    console.log(id, uid);
                    if (id === uid) {
                        return;
                    }
                    event.track.onmute = (event) => {
                        console.log("onmute", event);
                    };

                    let aid = 'peer-audio-' + id;
                    let el = select('#' + aid);
                    if (el) {
                        el.srcObject = stream;
                    } else {
                        el = document.createElement(event.track.kind)
                        el.id = aid;
                        el.srcObject = stream;
                        el.autoplay = true;
                        el.controls = false;
                        select('#peer').appendChild(el);
                    }
                };

                try {
                    const constraints = {
                        audio: {
                            echoCancellation: cancellingNoise,
                            noiseSuppression: cancellingNoise
                        },
                        video: false
                    };
                    Voice.stream = await navigator.mediaDevices.getUserMedia(constraints);
                } catch (err) {
                    if (Voice.status == VoiceStatus.CONNECTTING) {
                        Voice.errorMessage = "No microphone access";
                        Voice.status = VoiceStatus.ERROR;
                    }
                    return;
                }

                Voice.stream.getTracks().forEach((track) => {
                    track.enabled = !mutting;
                    Voice.conn.addTrack(track, Voice.stream);
                });

                await Voice.conn.setLocalDescription(await Voice.conn.createOffer());
                res = await rpc('publish', [rnameRPC, unameRPC, JSON.stringify(Voice.conn.localDescription)]);
                if (res.data) {
                    let jsep = JSON.parse(res.data.jsep);
                    if (jsep.type == 'answer') {
                        await Voice.conn.setRemoteDescription(jsep);
                        ucid = res.data.track;
                        await subscribe(Voice.conn);
                    }
                } else {
                    throw new Error('Unknown error');
                }
                Voice.conn.oniceconnectionstatechange = e => {
                    if (Voice.conn.iceConnectionState == "disconnected" || Voice.conn.iceConnectionState == "failed" || Voice.conn.iceConnectionState == "closed") {
                        Voice.errorMessage = "Connection lost";
                        Voice.status = VoiceStatus.ERROR;
                    } else {
                        if (Voice.status == VoiceStatus.ERROR) {
                            Voice.status = Voice._mutting ? VoiceStatus.MUTED : VoiceStatus.UNMUTED;
                        }
                    }
                }
            }

            async function rpc(method, params = [], retryTime = -1) {
                try {
                    const response = await window.videoTogetherExtension.Fetch(extension.video_together_host + "/kraken", "POST", { id: generateUUID(), method: method, params: params }, {
                        method: 'POST', // *GET, POST, PUT, DELETE, etc.
                        mode: 'cors', // no-cors, *cors, same-origin
                        cache: 'no-cache', // *default, no-cache, reload, force-cache, only-if-cached
                        credentials: 'omit', // include, *same-origin, omit
                        headers: {
                            'Content-Type': 'application/json'
                        },
                        redirect: 'follow', // manual, *follow, error
                        referrerPolicy: 'no-referrer', // no-referrer, *client
                        body: JSON.stringify({ id: generateUUID(), method: method, params: params }) // body data type must match "Content-Type" header
                    });
                    return await response.json(); // parses JSON response into native JavaScript objects
                } catch (err) {
                    if (Voice.status == VoiceStatus.STOP) {
                        return;
                    }
                    if (retryTime == 0) {
                        throw err;
                    }
                    await new Promise(r => setTimeout(r, 1000));
                    return await rpc(method, params, retryTime - 1);
                }
            }
        },
        stop: () => {
            try {
                Voice.conn.getSenders().forEach(s => {
                    if (s.track) {
                        s.track.stop();
                    }
                });
            } catch (e) { };

            [...select('#peer').querySelectorAll("*")].forEach(e => e.remove());
            try {
                Voice.conn.close();
                delete Voice.conn;
            } catch { }
            try {
                Voice.stream.getTracks().forEach(function (track) {
                    track.stop();
                });
                delete Voice.stream;
            } catch { }
            Voice.status = VoiceStatus.STOP;
        },
        mute: () => {
            Voice.conn.getSenders().forEach(s => {
                if (s.track) {
                    s.track.enabled = false;
                }
            });
            Voice._mutting = true;
            Voice.status = VoiceStatus.MUTED;
        },
        unmute: () => {
            Voice.conn.getSenders().forEach(s => {
                if (s.track) {
                    s.track.enabled = true;
                }
            });
            Voice._mutting = false;
            Voice.status = VoiceStatus.UNMUTED;
        },
        updateVoiceSetting: async (cancellingNoise = false) => {
            const constraints = {
                audio: {
                    echoCancellation: cancellingNoise,
                    noiseSuppression: cancellingNoise
                },
                video: false
            };
            try {
                prevStream = Voice.stream;
                Voice.stream = await navigator.mediaDevices.getUserMedia(constraints);
                Voice.conn.getSenders().forEach(s => {
                    if (s.track) {
                        s.replaceTrack(Voice.stream.getTracks().find(t => t.kind == s.track.kind));
                    }
                })
                prevStream.getTracks().forEach(t => t.stop());
                delete prevStream;
            } catch (e) { console.log(e); };
        }
    }

    function generateUUID() {
        if (crypto.randomUUID != undefined) {
            return crypto.randomUUID();
        }
        return ([1e7] + -1e3 + -4e3 + -8e3 + -1e11).replace(/[018]/g, c =>
            (c ^ crypto.getRandomValues(new Uint8Array(1))[0] & 15 >> c / 4).toString(16)
        );
    }

    function generateTempUserId() {
        return generateUUID() + ":" + Date.now() / 1000;
    }

    /**
     *
     *  Base64 encode / decode
     *  http://www.webtoolkit.info
     *
     **/
    const Base64 = {

        // private property
        _keyStr: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/="

        // public method for encoding
        , encode: function (input) {
            var output = "";
            var chr1, chr2, chr3, enc1, enc2, enc3, enc4;
            var i = 0;

            input = Base64._utf8_encode(input);

            while (i < input.length) {
                chr1 = input.charCodeAt(i++);
                chr2 = input.charCodeAt(i++);
                chr3 = input.charCodeAt(i++);

                enc1 = chr1 >> 2;
                enc2 = ((chr1 & 3) << 4) | (chr2 >> 4);
                enc3 = ((chr2 & 15) << 2) | (chr3 >> 6);
                enc4 = chr3 & 63;

                if (isNaN(chr2)) {
                    enc3 = enc4 = 64;
                }
                else if (isNaN(chr3)) {
                    enc4 = 64;
                }

                output = output +
                    this._keyStr.charAt(enc1) + this._keyStr.charAt(enc2) +
                    this._keyStr.charAt(enc3) + this._keyStr.charAt(enc4);
            } // Whend

            return output;
        } // End Function encode


        // public method for decoding
        , decode: function (input) {
            var output = "";
            var chr1, chr2, chr3;
            var enc1, enc2, enc3, enc4;
            var i = 0;

            input = input.replace(/[^A-Za-z0-9\+\/\=]/g, "");
            while (i < input.length) {
                enc1 = this._keyStr.indexOf(input.charAt(i++));
                enc2 = this._keyStr.indexOf(input.charAt(i++));
                enc3 = this._keyStr.indexOf(input.charAt(i++));
                enc4 = this._keyStr.indexOf(input.charAt(i++));

                chr1 = (enc1 << 2) | (enc2 >> 4);
                chr2 = ((enc2 & 15) << 4) | (enc3 >> 2);
                chr3 = ((enc3 & 3) << 6) | enc4;

                output = output + String.fromCharCode(chr1);

                if (enc3 != 64) {
                    output = output + String.fromCharCode(chr2);
                }

                if (enc4 != 64) {
                    output = output + String.fromCharCode(chr3);
                }

            } // Whend

            output = Base64._utf8_decode(output);

            return output;
        } // End Function decode


        // private method for UTF-8 encoding
        , _utf8_encode: function (string) {
            var utftext = "";
            string = string.replace(/\r\n/g, "\n");

            for (var n = 0; n < string.length; n++) {
                var c = string.charCodeAt(n);

                if (c < 128) {
                    utftext += String.fromCharCode(c);
                }
                else if ((c > 127) && (c < 2048)) {
                    utftext += String.fromCharCode((c >> 6) | 192);
                    utftext += String.fromCharCode((c & 63) | 128);
                }
                else {
                    utftext += String.fromCharCode((c >> 12) | 224);
                    utftext += String.fromCharCode(((c >> 6) & 63) | 128);
                    utftext += String.fromCharCode((c & 63) | 128);
                }

            } // Next n

            return utftext;
        } // End Function _utf8_encode

        // private method for UTF-8 decoding
        , _utf8_decode: function (utftext) {
            var string = "";
            var i = 0;
            var c, c1, c2, c3;
            c = c1 = c2 = 0;

            while (i < utftext.length) {
                c = utftext.charCodeAt(i);

                if (c < 128) {
                    string += String.fromCharCode(c);
                    i++;
                }
                else if ((c > 191) && (c < 224)) {
                    c2 = utftext.charCodeAt(i + 1);
                    string += String.fromCharCode(((c & 31) << 6) | (c2 & 63));
                    i += 2;
                }
                else {
                    c2 = utftext.charCodeAt(i + 1);
                    c3 = utftext.charCodeAt(i + 2);
                    string += String.fromCharCode(((c & 15) << 12) | ((c2 & 63) << 6) | (c3 & 63));
                    i += 3;
                }

            } // Whend

            return string;
        } // End Function _utf8_decode
    }

// 聊天记录存储 - 使用 window.getGM() 或 browser.storage.local (扩展) 或 GM (用户脚本) 或 localStorage (页面上下文)
function getStorage() {
    if (window.getGM) {
        const gm = window.getGM();
        return gm;
    }
    if (typeof browser !== 'undefined' && browser.storage && browser.storage.local) {
        return browser.storage.local;
    }
    if (typeof GM !== 'undefined') {
        return GM;
    }
    // Fallback to localStorage for page context
    return {
        get: async (key) => {
            const value = localStorage.getItem(key);
            return value ? JSON.parse(value) : null;
        },
        set: async (key, value) => {
            localStorage.setItem(key, JSON.stringify(value));
        }
    };
}

async function getNickname() {
    const storage = getStorage();
    console.log("getNickname storage:", storage);
    if (storage) {
        const result = await storage.get("ChatNickname");
        console.log("getNickname result:", result);
        return result && result.ChatNickname ? result.ChatNickname : "匿名用户";
    }
    console.log("getNickname: no storage, returning default");
    return "匿名用户";
}

async function getChatHistory() {
    try {
        const storage = getStorage();
        if (storage) {
            const result = await storage.get("ChatHistory");
            return result && result.ChatHistory ? result.ChatHistory : {};
        }
        return {};
    } catch {
        return {};
    }
}

async function saveChatHistory(history) {
    const storage = getStorage();
    if (storage) {
        await storage.set("ChatHistory", { ChatHistory: history });
    }
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

    let GotTxtMsgCallback = undefined;

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

    class VideoTogetherFlyPannel {
        showBubbleNotification(sender, content, container, position) {
            // 清理超过5个的旧气泡
            const existingBubbles = container.querySelectorAll(".chatBubble");
            if (existingBubbles.length >= 5) {
                existingBubbles[0].remove();
            }

            // 给所有现有气泡上移
            existingBubbles.forEach(b => {
                if (position && position.type === 'fullscreen') {
                    const currentTop = parseInt(b.style.top) || -45;
                    b.style.top = (currentTop - 40) + 'px';
                } else {
                    const currentBottom = parseInt(b.style.bottom) || 45;
                    b.style.bottom = (currentBottom + 40) + 'px';
                }
            });

            // 创建气泡
            const bubble = document.createElement("div");
            bubble.className = "chatBubble";
            let bubbleStyle;
            if (position && position.type === 'fullscreen') {
                // 全屏时使用绝对定位，附加到 bubbles-container
                bubbleStyle = `
                    position: absolute;
                    right: 0;
                    top: -45px;
                    background: rgba(30, 30, 30, 0.85);
                    backdrop-filter: blur(10px);
                    border-radius: 12px;
                    padding: 10px 14px;
                    box-shadow: 0 4px 12px rgba(0,0,0,0.2);
                    max-width: 220px;
                    font-size: 13px;
                    z-index: 2147483647;
                    color: #fff;
                    opacity: 0;
                    transform: translateY(10px);
                    transition: opacity 0.3s ease-out, transform 0.3s ease-out, top 0.3s ease-out;
                `;
            } else {
                bubbleStyle = `
                    position: fixed;
                    right: 20px;
                    bottom: 45px;
                    background: rgba(30, 30, 30, 0.85);
                    backdrop-filter: blur(10px);
                    border-radius: 12px;
                    padding: 10px 14px;
                    box-shadow: 0 4px 12px rgba(0,0,0,0.2);
                    max-width: 220px;
                    font-size: 13px;
                    z-index: 2147483647;
                    color: #fff;
                    opacity: 0;
                    transform: translateY(10px);
                    transition: opacity 0.3s ease-out, transform 0.3s ease-out, bottom 0.3s ease-out;
                `;
            }
            bubble.style.cssText = bubbleStyle;

            bubble.innerHTML = `<span style="color: #4ecdc4; font-weight: 600;">${escapeHtml(sender)}</span>: ${escapeHtml(content)}`;

            container.appendChild(bubble);

            // 立即显示
            requestAnimationFrame(() => {
                bubble.style.opacity = '1';
                bubble.style.transform = 'translateY(0)';
            });

            // 3秒后自动消失，悬浮时持续存在
            let hideTimer;
            const startHideTimer = () => {
                hideTimer = setTimeout(() => {
                    bubble.style.opacity = '0';
                    bubble.style.transform = 'translateY(10px)';
                    setTimeout(() => bubble.remove(), 300);
                }, 3000);
            };
            const clearHideTimer = () => {
                clearTimeout(hideTimer);
                bubble.style.opacity = '1';
                bubble.style.transform = 'translateY(0)';
            };

            bubble.addEventListener('mouseenter', clearHideTimer);
            bubble.addEventListener('mouseleave', startHideTimer);
            startHideTimer();
        }

        constructor() {
            this.sessionKey = "VideoTogetherFlySaveSessionKey";
            this.isInRoom = false;

            this.isMain = (window.self == window.top);
            setInterval(() => {
                if (getEnableMiniBar() && getEnableTextMessage() && document.fullscreenElement != undefined
                    && (extension.ctxRole == extension.RoleEnum.Master || extension.ctxRole == extension.RoleEnum.Member)) {
                    const qs = (s) => this.fullscreenWrapper.querySelector(s);
                    try {
                        qs("#memberCount").innerText = extension.ctxMemberCount;
                        qs("#send-button").disabled = !extension.ctxWsIsOpen;
                    } catch { };
                    if (document.fullscreenElement.contains(this.fullscreenSWrapper)) {
                        return;
                    }
                    let shadowWrapper = document.createElement("div");
                    this.fullscreenSWrapper = shadowWrapper;
                    shadowWrapper.id = "VideoTogetherfullscreenSWrapper";
                    let wrapper;
                    try {
                        wrapper = AttachShadow(shadowWrapper, { mode: "open" });
                        wrapper.addEventListener('keydown', (e) => e.stopPropagation());
                        this.fullscreenWrapper = wrapper;
                    } catch (e) { console.error(e); }
                    updateInnnerHTML(wrapper, `<style>
    .container {
        position: absolute;
        top: 50%;
        left: 0px;
        border: 1px solid #000;
        padding: 0px;
        display: flex;
        align-items: center;
        justify-content: space-between;
        width: fit-content;
        justify-content: center;
        border-radius: 5px;
        opacity: 80%;
        background: #000;
        color: white;
        z-index: 2147483647;
    }

    #bubbles-container {
        position: absolute;
        bottom: 100%;
        right: 0;
        width: 220px;
    }

    .container input[type='text'] {
        padding: 0px;
        flex-grow: 1;
        border: none;
        height: 24px;
        width: 0px;
        height: 32px;
        transition: width 0.1s linear;
        background-color: transparent;
        color: white;
    }

    .container input[type='text'].expand {
        width: 150px;
    }

    .container .user-info {
        display: flex;
        align-items: center;
    }

    .container button {
        height: 32px;
        font-size: 16px;
        border: 0px;
        color: white;
        text-align: center;
        text-decoration: none;
        display: inline-block;
        background-color: #1890ff;
        transition-duration: 0.4s;
        border-radius: 4px;
    }

    .container #expand-button {
        color: black;
        font-weight: bolder;
        height: 32px;
        width: 32px;
        background-size: cover;
        background-image: url(data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAMAAAAoLQ9TAAAABGdBTUEAALGPC/xhBQAAACBjSFJNAAB6JgAAgIQAAPoAAACA6AAAdTAAAOpgAAA6mAAAF3CculE8AAACrFBMVEXg9b7e87jd87jd9Lnd9Lre9Lng9b/j98jm98vs99fy9ubu89/e1sfJqKnFnqLGoaXf9Lvd87Xe87fd8rfV67Ti9sbk98nm9sze48TX3rjU1rTKr6jFnaLe9Lfe87Xe9LjV7LPN4q3g78PJuqfQ1a7OzarIsabEnaHi9sXd8rvd8rbd87axx4u70Jrl+cvm+szQxq25lZTR1a7KvaXFo6LFnaHEnKHd6r3Y57TZ7bLb8bTZ7rKMomClun/k+MrOx6yue4PIvqfP06vLv6fFoqLEnKDT27DS3a3W6K7Y7bDT6auNq2eYn3KqlYShYXTOwLDAzZ7MyanKtqbEoaHDm6DDm5/R2K3Q2KzT4q3W6a7P3amUhWp7SEuMc2rSyri3zJe0xpPV17TKuqbGrqLEnqDQ2K3O06rP0arR2qzJx6GZX160j4rP1LOiuH2GnVzS3rXb47zQ063OzanHr6PDnaDMxajIsaXLwKfEt5y6mI/GyqSClVZzi0bDzp+8nY/d6L/X4rbQ1qzMyKjEqKHFpqLFpaLGqaO2p5KCjlZ5jky8z5izjoOaXmLc5r3Z57jU4K7S3K3NyqnBm56Mg2KTmWnM0KmwhH2IOUunfXnh8cXe8b7Z7LPV4rDBmZ3Cmp+6mZWkk32/qZihbG97P0OdinXQ3rTk+Mjf9L/d8rja6ri9lpqnh4qhgoWyk5Kmd3qmfHW3oou2vZGKpmaUrXDg9MPf9L3e876yj5Ori42Mc3aDbG6MYmyifXfHyaPU3rHH0aKDlVhkejW70Zbf9bze87be87ng9cCLcnWQd3qEbG9/ZmmBXmSflYS4u5ra5Lnd6r7U5ba2ypPB153c87re9b2Ba22EbW+AamyDb3CNgXmxsZng7sTj9sjk98rk+Mng9cHe9Lze9Lrd87n////PlyWlAAAAAWJLR0TjsQauigAAAAlwSFlzAAAOxAAADsQBlSsOGwAAAAd0SU1FB+YGGQYXBzHy0g0AAAEbSURBVBjTARAB7/4AAAECAwQFBgcICQoLDA0ODwAQEREREhMUFRYXGBkaGxwOAAYdHhEfICEWFiIjJCUmDicAKCkqKx8sLS4vMDEyMzQ1NgA3ODk6Ozw9Pj9AQUJDRDVFAEZHSElKS0xNTk9QUVJTVFUAVldYWVpbXF1eX2BhYmNkVABlZmdoaWprbG1ub3BxcnN0AEJ1dnd4eXp7fH1+f4CBgoMAc4QnhYaHiImKi4yNjo+QkQBFVFU2kpOUlZaXmJmam5ucAFRVnZ6foKGio6SlpqeoE6kAVaqrrK2ur7CxsrO0tQEDtgC3uLm6u7y9vr/AwcLDxMXGAMfIycrLzM3Oz9DR0tMdAdQA1da619jZ2tvc3d7f4OEB4iRLaea64H7qAAAAJXRFWHRkYXRlOmNyZWF0ZQAyMDIyLTA2LTI1VDA2OjIzOjAyKzAwOjAwlVQlhgAAACV0RVh0ZGF0ZTptb2RpZnkAMjAyMi0wNi0yNVQwNjoyMzowMiswMDowMOQJnToAAAAgdEVYdHNvZnR3YXJlAGh0dHBzOi8vaW1hZ2VtYWdpY2sub3JnvM8dnQAAABh0RVh0VGh1bWI6OkRvY3VtZW50OjpQYWdlcwAxp/+7LwAAABh0RVh0VGh1bWI6OkltYWdlOjpIZWlnaHQAMTkyQF1xVQAAABd0RVh0VGh1bWI6OkltYWdlOjpXaWR0aAAxOTLTrCEIAAAAGXRFWHRUaHVtYjo6TWltZXR5cGUAaW1hZ2UvcG5nP7JWTgAAABd0RVh0VGh1bWI6Ok1UaW1lADE2NTYxMzgxODJHYkS0AAAAD3RFWHRUaHVtYjo6U2l6ZQAwQkKUoj7sAAAAVnRFWHRUaHVtYjo6VVJJAGZpbGU6Ly8vbW50bG9nL2Zhdmljb25zLzIwMjItMDYtMjUvNGU5YzJlYjRjNmRhMjIwZDgzYjcyOTYxZmI1ZTJiY2UuaWNvLnBuZ7tNVVEAAAAASUVORK5CYII=);
    }

    .container #close-btn {
        height: 16px;
        max-width: 24px;
        background-color: rgba(255, 0, 0, 0.5);
        font-size: 8px;
    }

    .container #close-btn:hover {
        background-color: rgba(255, 0, 0, 0.3);
    }

    .container button:hover {
        background-color: #6ebff4;
    }

    .container button:disabled,
    .container button:disabled:hover {
        background-color: rgb(76, 76, 76);
    }

    .container #chatHistory {
        display: none;
        position: absolute;
        bottom: 40px;
        right: 0;
        width: 220px;
        max-height: 200px;
        overflow-y: auto;
        background: rgba(30, 30, 30, 0.9);
        border-radius: 8px;
        padding: 8px;
        color: #fff;
        font-size: 12px;
    }

    .container #chatHistory.show {
        display: block;
    }

    .container .chat-message {
        margin-bottom: 6px;
        padding: 4px 8px;
        background: rgba(255, 255, 255, 0.1);
        border-radius: 6px;
        word-break: break-all;
    }

    .container .chat-message .sender {
        font-weight: 600;
        color: #4ecdc4;
        font-size: 11px;
    }

    .container .chat-message .content {
        margin-top: 2px;
    }
</style>
<div class="container" id="container">
    <div id="bubbles-container"></div>
    <div id="chatHistory"></div>
    <button id="expand-button">&lt;</button>
    <div style="padding: 0 5px 0 5px;" class="user-info" id="user-info">
        <span class="emoji">👥</span>
        <span id="memberCount">0</span>
    </div>
    <button id="close-btn">x</button>
    <input style="margin: 0 0 0 5px;" type="text" placeholder="Text Message" id="text-input" class="expand" />
    <button id="send-button">Send</button>
</div>`);
                    document.fullscreenElement.appendChild(shadowWrapper);
                    var container = wrapper.getElementById('container');
                    let expandBtn = wrapper.getElementById('expand-button');
                    let msgInput = wrapper.getElementById('text-input');
                    let sendBtn = wrapper.getElementById('send-button');
                    let closeBtn = wrapper.getElementById('close-btn');
                    let expanded = true;
                    const chatHistoryEl = wrapper.getElementById('chatHistory');
                    // 初始状态已展开，显示聊天记录
                    if (chatHistoryEl) {
                        chatHistoryEl.classList.add('show');
                    }
                    // 加载聊天历史
                    if (chatHistoryEl) {
                        const roomId = extension.roomName || "default";
                        getRoomChatHistory(roomId).then(messages => {
                            if (chatHistoryEl.children.length === 0) {
                                messages.forEach(msg => {
                                    renderChatMessage(chatHistoryEl, msg.sender, msg.content, msg.isSelf);
                                });
                            }
                        }).catch(() => {});
                    }
                    function expand() {
                        if (expanded) {
                            // 当前是展开状态，切换到收起
                            expandBtn.innerText = '>'
                            sendBtn.style.display = 'none';
                            msgInput.classList.remove('expand');
                            if (chatHistoryEl) chatHistoryEl.classList.remove('show');
                        } else {
                            // 当前是收起状态，切换到展开
                            expandBtn.innerText = '<';
                            sendBtn.style.display = 'inline-block';
                            msgInput.classList.add("expand");
                            if (chatHistoryEl) chatHistoryEl.classList.add('show');
                        }
                        expanded = !expanded;
                    }
                    closeBtn.onclick = () => { shadowWrapper.style.display = "none"; }
                    wrapper.getElementById('expand-button').addEventListener('click', () => expand());
                    sendBtn.onclick = async () => {
                        extension.currentSendingMsgId = generateUUID();
                        const nickname = await getNickname();
                        const content = msgInput.value;
                        const wrappedMsg = wrapMessage(nickname, content);
                        sendMessageToTop(MessageType.SendTxtMsg, { currentSendingMsgId: extension.currentSendingMsgId, value: wrappedMsg });
                    }
                    GotTxtMsgCallback = async (id, msg) => {
                        console.log(id, msg);
                        const parsed = parseMessage(msg);
                        const roomId = extension.roomName || "default";
                        const isSelf = id == extension.currentSendingMsgId;

                        // 存储到历史记录
                        await addMessageToHistory(roomId, parsed.sender, parsed.content, isSelf);

                        // 渲染到 UI
                        if (chatHistoryEl) {
                            renderChatMessage(chatHistoryEl, parsed.sender, parsed.content, isSelf);
                        }

                        // 气泡通知（仅接收方，全屏面板收起时显示）
                        if (!isSelf && !expanded) {
                            this.showBubbleNotification(parsed.sender, parsed.content, this.fullscreenWrapper.getElementById('bubbles-container'), { type: 'fullscreen' });
                        }

                        // TTS（发送人自己不发TTS）
                        if (!isSelf) {
                            extension.gotTextMsg(id, parsed.content, false, -1);
                        }

                        if (isSelf) {
                            msgInput.value = "";
                        }
                    }
                    msgInput.addEventListener("keyup", e => {
                        if (e.key == "Enter") {
                            sendBtn.click();
                        }
                    });
                } else {
                    if (this.fullscreenSWrapper != undefined) {
                        this.fullscreenSWrapper.remove();
                        this.fullscreenSWrapper = undefined;
                        this.fullscreenWrapper = undefined;
                        GotTxtMsgCallback = undefined;
                    }
                }
            }, 500);
            if (this.isMain) {
                document.addEventListener("click", () => {
                    this.enableSpeechSynthesis();
                });
                this.minimized = false;
                let shadowWrapper = document.createElement("div");
                shadowWrapper.id = "VideoTogetherWrapper";
                shadowWrapper.ontouchstart = (e) => { e.stopPropagation() }
                let wrapper;
                try {
                    wrapper = AttachShadow(shadowWrapper, { mode: "open" });
                    wrapper.addEventListener('keydown', (e) => e.stopPropagation())
                } catch (e) { console.error(e); }

                this.shadowWrapper = shadowWrapper;
                this.wrapper = wrapper;
                updateInnnerHTML(wrapper, `<div id="peer" style="display: none;"></div>
<div id="videoTogetherFlyPannel" style="display: none;">
  <div id="videoTogetherHeader" class="vt-modal-header">
    <span id="memberCount" style="font-size: 12px; color: #888; flex-shrink: 0;"></span>
    <span id="videoTogetherRoleText" style="font-size: 12px; color: #666; flex-shrink: 0; margin-left: 8px;"></span>

    <button class="nickname-btn" id="nicknameBtn" style="margin-left: 8px;">
      <span>👤</span>
      <span id="nicknameText">匿名用户</span>
    </button>

    <div style="flex: 1;"></div>

    <span id="roomNameDisplay" style="font-size: 12px; color: #333; flex-shrink: 0; display: none;"></span>

    <div style="flex: 1;"></div>

    <button id="downloadBtn" type="button" class="vt-modal-title-button vt-modal-easyshare" style="display: none; padding: 4px;">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
        <path d="M12 16.5061C11.5894 16.6615 11.2106 16.75 11 16.75C10.7894 16.75 10.5886 16.6615 10.4465 16.5061L6.44648 12.1311C6.16698 11.8254 6.18822 11.351 6.49392 11.0715C6.79963 10.792 7.27402 10.8132 7.55352 11.1189L10.25 14.0682V3C10.25 2.58579 10.5858 2.25 11 2.25C11.4142 2.25 11.75 2.58579 11.75 3V14.0682L14.4465 11.1189C14.726 10.8132 15.2004 10.792 15.5061 11.0715C15.8118 11.351 15.833 11.8254 15.5535 12.1311L11.5535 16.5061Z" fill="currentColor"/>
      </svg>
    </button>

    <button style="display: none;" id="easyShareCopyBtn" type="button" class="vt-modal-title-button vt-modal-easyshare" style="padding: 4px;">
      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 32 32">
        <path fill="currentColor" d="M0 25.472q0 2.368 1.664 4.032t4.032 1.664h18.944q2.336 0 4-1.664t1.664-4.032v-8.192l-3.776 3.168v5.024q0 0.8-0.544 1.344t-1.344 0.576h-18.944q-0.8 0-1.344-0.576t-0.544-1.344v-18.944q0-0.768 0.544-1.344t1.344-0.544h9.472v-3.776h-9.472q-2.368 0-4.032 1.664t-1.664 4v18.944z"/>
      </svg>
    </button>

    <a href="https://setting.2gether.video/" target="_blank" id="videoTogetherSetting" aria-label="Setting" class="vt-modal-title-button" style="padding: 4px;">
      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
        <path d="M24 13.616v-3.232c-1.651-.587-2.694-.752-3.219-2.019v-.001c-.527-1.271.1-2.134.847-3.707l-2.285-2.285c-1.561.742-2.433 1.375-3.707.847h-.001c-1.269-.526-1.435-1.576-2.019-3.219h-3.232c-.582 1.635-.749 2.692-2.019 3.219h-.001c-1.271.528-2.132-.098-3.707-.847l-2.285 2.285c.745 1.568 1.375 2.434.847 3.707-.527 1.271-1.584 1.438-3.219 2.02v3.232c1.632.58 2.692.749 3.219 2.019.53 1.282-.114 2.166-.847 3.707l2.285 2.286c1.562-.743 2.434-1.375 3.707-.847h.001c1.27.526 1.436 1.579 2.019 3.219h3.232c.582-1.636.75-2.69 2.027-3.222h.001c1.262-.524 2.12.101 3.698.851l2.285-2.286c-.744-1.563-1.375-2.433-.848-3.706.527-1.271 1.588-1.44 3.221-2.021zm-12 2.384c-2.209 0-4-1.791-4-4s1.791-4 4-4 4 1.791 4 4-1.791 4-4 4z" />
      </svg>
    </a>

    <a href="https://afdian.com/a/videotogether" target="_blank" id="vtDonate" class="vt-modal-title-button" style="padding: 4px;">
      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24">
        <path fill="red" d="M12 4.435c-1.989-5.399-12-4.597-12 3.568 0 4.068 3.06 9.481 12 14.997 8.94-5.516 12-10.929 12-14.997 0-8.118-10-8.999-12-3.568z" />
      </svg>
    </a>

    <button id="videoTogetherMinimize" type="button" aria-label="Minimize" class="vt-modal-title-button" style="padding: 4px;">
      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
        <path d="M18 12.998H6a1 1 0 0 1 0-2h12a1 1 0 0 1 0 2z"></path>
      </svg>
    </button>
  </div>

  <div id="nicknameEditRow" class="nickname-edit-row" style="display: none;">
    <span style="font-size: 12px; color: #666; flex-shrink: 0;">编辑昵称:</span>
    <input type="text" id="nicknameInput" placeholder="输入昵称" maxlength="20" style="flex: 1; min-width: 0;" />
    <button id="saveNicknameBtn" class="vt-btn vt-btn-primary" style="padding: 2px 8px; height: auto; font-size: 12px;">保存</button>
    <button id="cancelNicknameEditBtn" class="vt-btn" style="padding: 2px 8px; height: auto; font-size: 12px;">取消</button>
  </div>

  <div class="vt-modal-content">

    <div class="vt-modal-body">
      <div id="mainPannel" class="content" style="display: flex; flex-direction: column; width: 100%; flex: 1; min-height: 0; gap: 8px;">
        <div id="videoTogetherStatusText" style="color: #666; font-size: 12px;"></div>
        <div id="roomInputContainer" style="display: flex; flex-direction: column; gap: 8px; padding: 10px 0; width: 100%;">
          <div style="display: flex; align-items: center; gap: 8px;">
            <span class="ellipsis" id="videoTogetherRoomNameLabel" style="width: 70px; flex-shrink: 0;">Room</span>
            <input id="videoTogetherRoomNameInput" autocomplete="off" placeholder="Name of room" style="flex: 1; height: 36px; padding: 0 12px; font-size: 14px; border-radius: 8px; border: 1px solid #d9d9d9;">
          </div>
          <div style="display: flex; align-items: center; gap: 8px;">
            <span class="ellipsis" id="videoTogetherRoomPasswordLabel" style="width: 70px; flex-shrink: 0; display: none;">Password</span>
            <input id="videoTogetherRoomPdIpt" autocomplete="off" placeholder="Host's password" style="flex: 1; height: 36px; padding: 0 12px; font-size: 14px; border-radius: 8px; border: 1px solid #d9d9d9; display: none;">
          </div>
        </div>
        <div id="textMessageChat" style="display: none; flex-direction: column; flex: 1; min-height: 0; overflow: hidden;">
          <div id="chatHistory" style="flex: 1; min-height: 0; max-height: 100%; overflow-y: auto; margin-bottom: 8px; text-align: left; width: 100%;"></div>
        </div>
        <div id="textMessageConnecting" style="display: none;">
          <span id="textMessageConnectingStatus">Connecting to Message service...</span>
          <span id="zhcnTtsMissing"></span>
        </div>
      </div>

      <div id="voicePannel" class="content" style="display: none; flex-direction: column; gap: 8px; width: 100%; flex: 1; min-height: 0;">
        <div id="videoVolumeCtrl" style="width: 100%;text-align: left;">
          <span style="display: inline-block;width: 100px;margin-left: 20px;">Video volume</span>
          <div class="range-slider">
            <input id="videoVolume" class="slider" type="range" value="100" min="0" max="100">
          </div>
        </div>
        <div id="callVolumeCtrl" style="width: 100%;text-align: left;">
          <span style="display: inline-block;width: 100px;margin-left: 20px;">Call Volume</span>
          <div class="range-slider">
            <input id="callVolume" class="slider" type="range" value="100" min="0" max="100">
          </div>
        </div>
        <div id="iosVolumeErr" style="display: none;">
          <p>iOS does not support volume adjustment</p>
        </div>
      </div>

      <div id="downloadPannel" style="display: none;">
        <div>
          <span id="downloadVideoInfo">Detecting video...</span>
          <button id="confirmDownloadBtn" style="display: none;" class="vt-btn vt-btn-primary" type="button">
            <span>Confirm and download</span>
          </button>
          <div id="downloadProgress" style="display: none;">
            <progress id="downloadProgressBar" style="width: 100%;" value="0" max="100"></progress>
            <div id="speedAndStatus" style="width: 100%;">
              <span id="downloadStatus"></span>
              <span id="downloadSpeed"></span>
            </div>
            <span id="downloadingAlert" style="color: red;">Downloading, do not close page</span>
            <span id="downloadCompleted" style="color: green; display: none;">Download complete</span>
          </div>
        </div>
        <div style="display: block;">
          <a target="_blank" style="display: block;padding: 5px 5px;"
            href="https://local.2gether.video/local_videos.en-us.html">View downloaded videos</a>
          <a target="_blank" style="display: block;padding: 5px 5px;"
            href="https://local.2gether.video/about.en-us.html">Copyright Notice</a>
        </div>
      </div>
    </div>

    <div id="snackbar"></div>

    <div class="vt-modal-footer">

      <div id="chatInputRow" style="display: flex; gap: 6px; width: 100%; align-items: center; flex-direction: row; flex-wrap: nowrap; box-sizing: border-box;">
        <input id="textMessageInput" autocomplete="off" placeholder="Text Message" style="flex: 1; min-width: 60px; height: 34px; padding: 0 10px; font-size: 13px; border-radius: 6px; border: 1px solid #d9d9d9;">
        <button id="textMessageSend" class="vt-btn vt-btn-primary" type="button" style="height: 34px; padding: 0 16px; font-size: 13px; border-radius: 6px; flex-shrink: 0;">
          <span>Send</span>
        </button>
      </div>

      <div id="lobbyBtnGroup" style="display: flex; gap: 8px; flex-wrap: wrap; justify-content: center;">
        <button id="videoTogetherCreateButton" class="vt-btn vt-btn-primary" type="button" style="height: 34px; padding: 0 14px; font-size: 14px; border-radius: 10px;">
          <span>Create</span>
        </button>
        <button id="videoTogetherJoinButton" class="vt-btn vt-btn-secondary" type="button" style="height: 34px; padding: 0 14px; font-size: 14px; border-radius: 10px;">
          <span>Join</span>
        </button>
        <button id="chatHistoryBtn" class="vt-btn" type="button" style="height: 34px; padding: 0 14px; font-size: 14px; border-radius: 10px;">
          <span>Chat History</span>
        </button>
      </div>

      <div id="roomButtonGroup" style="display: none; flex-direction: column; gap: 6px;">
        <div style="display: flex; gap: 6px; justify-content: center;">
          <button id="videoTogetherExitButton" class="vt-btn vt-btn-dangerous" type="button" style="height: 34px; padding: 0 14px; font-size: 14px; border-radius: 10px;">
            <span>Exit</span>
          </button>
          <button id="callBtn" class="vt-btn vt-btn-dangerous" type="button" style="height: 34px; padding: 0 14px; font-size: 14px; border-radius: 10px;">
            <span>Call</span>
          </button>
          <button id="ttsBtn" class="vt-btn" type="button" style="height: 34px; padding: 0 14px; font-size: 14px; border-radius: 10px;">
            <span>TTS</span>
          </button>
          <button id="chatHistoryBtnRoom" class="vt-btn" type="button" style="height: 34px; padding: 0 14px; font-size: 14px; border-radius: 10px;">
            <span>Chat History</span>
          </button>
        </div>
        <div style="display: flex; gap: 6px; justify-content: center; align-items: center;">
          <div id="callConnecting" class="lds-ellipsis" style="display: none;">
            <div></div>
            <div></div>
            <div></div>
            <div></div>
          </div>
          <button id="callErrorBtn" class="vt-modal-title-button error-button vt-btn" style="display: none; height: 26px; padding: 0 8px;">
            <svg width="16px" height="16px" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
              <path fill="currentColor" d="M11.001 10h2v5h-2zM11 16h2v2h-2z" />
              <path fill="currentColor"
                d="M13.768 4.2C13.42 3.545 12.742 3.138 12 3.138s-1.42.407-1.768 1.063L2.894 18.064a1.986 1.986 0 0 0 .054 1.968A1.984 1.984 0 0 0 4.661 21h14.678c.708 0 1.349-.362 1.714-.968a1.989 1.989 0 0 0 .054-1.968L13.768 4.2zM4.661 19 12 5.137 19.344 19H4.661z" />
            </svg>
          </button>
          <button id="audioBtn" style="display: none;" type="button" aria-label="Mute"
            class="vt-btn vt-modal-audio">
            <svg width="16px" height="16px" viewBox="0 0 489.6 489.6" fill="currentColor">
              <path d="M361.1,337.6c2.2,1.5,4.6,2.3,7.1,2.3c3.8,0,7.6-1.8,10-5.2c18.7-26.3,28.5-57.4,28.5-89.9s-9.9-63.6-28.5-89.9
              c-3.9-5.5-11.6-6.8-17.1-2.9c-5.5,3.9-6.8,11.6-2.9,17.1c15.7,22.1,24,48.3,24,75.8c0,27.4-8.3,53.6-24,75.8
              C354.3,326.1,355.6,333.7,361.1,337.6z" />
              <path d="M425.4,396.3c2.2,1.5,4.6,2.3,7.1,2.3c3.8,0,7.6-1.8,10-5.2c30.8-43.4,47.1-94.8,47.1-148.6s-16.3-105.1-47.1-148.6
              c-3.9-5.5-11.6-6.8-17.1-2.9c-5.5,3.9-6.8,11.6-2.9,17.1c27.9,39.3,42.6,85.7,42.6,134.4c0,48.6-14.7,95.1-42.6,134.4
              C418.6,384.7,419.9,392.3,425.4,396.3z" />
              <path d="M254.7,415.7c4.3,2.5,9.2,3.8,14.2,3.8l0,0c7.4,0,14.4-2.8,19.7-7.9c5.6-5.4,8.7-12.6,8.7-20.4V98.5
              c0-15.7-12.7-28.4-28.4-28.4c-4.9,0-9.8,1.3-14.2,3.8c-0.3,0.2-0.6,0.3-0.8,0.5l-100.1,69.2H73.3C32.9,143.6,0,176.5,0,216.9v55.6
              c0,40.4,32.9,73.3,73.3,73.3h84.5l95.9,69.2C254,415.3,254.4,415.5,254.7,415.7z M161.8,321.3H73.3c-26.9,0-48.8-21.9-48.8-48.8
              v-55.6c0-26.9,21.9-48.8,48.8-48.8h84.3c2.5,0,4.9-0.8,7-2.2l102.7-71c0.5-0.3,1.1-0.4,1.6-0.4c1.6,0,3.9,1.2,3.9,3.9v292.7
              c0,1.1-0.4,2-1.1,2.8c-0.7,0.7-1.8,1.1-2.7,1.1c-0.5,0-1-0.1-1.5-0.3l-98.4-71.1C166.9,322.1,164.4,321.3,161.8,321.3z" />
            </svg>
          </button>
          <button id="micBtn" style="display: none;" type="button" aria-label="Microphone"
            class="vt-btn vt-modal-mic">
            <svg id="micIconNoSlash" width="16px" height="16px" viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="2">
              <rect width="48" height="48" fill="white" fill-opacity="0" />
              <path d="M31 24V11C31 7.13401 27.866 4 24 4C20.134 4 17 7.13401 17 11V24C17 27.866 20.134 31 24 31C27.866 31 31 27.866 31 24Z" stroke-linejoin="round" />
              <path d="M9 23C9 31.2843 15.7157 38 24 38C32.2843 38 39 31.2843 39 23" stroke-linecap="round" stroke-linejoin="round" />
              <path d="M24 38V44" stroke-linecap="round" stroke-linejoin="round" />
            </svg>
            <svg id="micIconWithSlash" style="display: none;" width="16px" height="16px" viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="2">
              <rect width="48" height="48" fill="white" fill-opacity="0" />
              <path d="M31 24V11C31 7.13401 27.866 4 24 4C20.134 4 17 7.13401 17 11V24C17 27.866 20.134 31 24 31C27.866 31 31 27.866 31 24Z" stroke-linejoin="round" />
              <path d="M9 23C9 31.2843 15.7157 38 24 38C32.2843 38 39 31.2843 39 23" stroke-linecap="round" stroke-linejoin="round" />
              <path d="M24 38V44" stroke-linecap="round" stroke-linejoin="round" />
              <path d="M42 42L6 6" stroke-linecap="round" stroke-linejoin="round" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  </div>
</div>
<div style="width: 24px; height: 24px;" id="videoTogetherSamllIcon">
  <img draggable="false" width="24px" height="24px" id="videoTogetherMaximize"
    src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAMAAAAoLQ9TAAAABGdBTUEAALGPC/xhBQAAACBjSFJNAAB6JgAAgIQAAPoAAACA6AAAdTAAAOpgAAA6mAAAF3CculE8AAACrFBMVEXg9b7e87jd87jd9Lnd9Lre9Lng9b/j98jm98vs99fy9ubu89/e1sfJqKnFnqLGoaXf9Lvd87Xe87fd8rfV67Ti9sbk98nm9sze48TX3rjU1rTKr6jFnaLe9Lfe87Xe9LjV7LPN4q3g78PJuqfQ1a7OzarIsabEnaHi9sXd8rvd8rbd87axx4u70Jrl+cvm+szQxq25lZTR1a7KvaXFo6LFnaHEnKHd6r3Y57TZ7bLb8bTZ7rKMomClun/k+MrOx6yue4PIvqfP06vLv6fFoqLEnKDT27DS3a3W6K7Y7bDT6auNq2eYn3KqlYShYXTOwLDAzZ7MyanKtqbEoaHDm6DDm5/R2K3Q2KzT4q3W6a7P3amUhWp7SEuMc2rSyri3zJe0xpPV17TKuqbGrqLEnqDQ2K3O06rP0arR2qzJx6GZX160j4rP1LOiuH2GnVzS3rXb47zQ063OzanHr6PDnaDMxajIsaXLwKfEt5y6mI/GyqSClVZzi0bDzp+8nY/d6L/X4rbQ1qzMyKjEqKHFpqLFpaLGqaO2p5KCjlZ5jky8z5izjoOaXmLc5r3Z57jU4K7S3K3NyqnBm56Mg2KTmWnM0KmwhH2IOUunfXnh8cXe8b7Z7LPV4rDBmZ3Cmp+6mZWkk32/qZihbG97P0OdinXQ3rTk+Mjf9L/d8rja6ri9lpqnh4qhgoWyk5Kmd3qmfHW3oou2vZGKpmaUrXDg9MPf9L3e876yj5Ori42Mc3aDbG6MYmyifXfHyaPU3rHH0aKDlVhkejW70Zbf9bze87be87ng9cCLcnWQd3qEbG9/ZmmBXmSflYS4u5ra5Lnd6r7U5ba2ypPB153c87re9b2Ba22EbW+AamyDb3CNgXmxsZng7sTj9sjk98rk+Mng9cHe9Lze9Lrd87n////PlyWlAAAAAWJLR0TjsQauigAAAAlwSFlzAAAOxAAADsQBlSsOGwAAAAd0SU1FB+YGGQYXBzHy0g0AAAEbSURBVBjTARAB7/4AAAECAwQFBgcICQoLDA0ODwAQEREREhMUFRYXGBkaGxwOAAYdHhEfICEWFiIjJCUmDicAKCkqKx8sLS4vMDEyMzQ1NgA3ODk6Ozw9Pj9AQUJDRDVFAEZHSElKS0xNTk9QUVJTVFUAVldYWVpbXF1eX2BhYmNkVABlZmdoaWprbG1ub3BxcnN0AEJ1dnd4eXp7fH1+f4CBgoMAc4QnhYaHiImKi4yNjo+QkQBFVFU2kpOUlZaXmJmam5ucAFRVnZ6foKGio6SlpqeoE6kAVaqrrK2ur7CxsrO0tQEDtgC3uLm6u7y9vr/AwcLDxMXGAMfIycrLzM3Oz9DR0tMdAdQA1da619jZ2tvc3d7f4OEB4iRLaea64H7qAAAAJXRFWHRkYXRlOmNyZWF0ZQAyMDIyLTA2LTI1VDA2OjIzOjAyKzAwOjAwlVQlhgAAACV0RVh0ZGF0ZTptb2RpZnkAMjAyMi0wNi0yNVQwNjoyMzowMiswMDowMOQJnToAAAAgdEVYdHNvZnR3YXJlAGh0dHBzOi8vaW1hZ2VtYWdpY2sub3JnvM8dnQAAABh0RVh0VGh1bWI6OkRvY3VtZW50OjpQYWdlcwAxp/+7LwAAABh0RVh0VGh1bWI6OkltYWdlOjpIZWlnaHQAMTkyQF1xVQAAABd0RVh0VGh1bWI6OkltYWdlOjpXaWR0aAAxOTLTrCEIAAAAGXRFWHRUaHVtYjo6TWltZXR5cGUAaW1hZ2UvcG5nP7JWTgAAABd0RVh0VGh1bWI6Ok1UaW1lADE2NTYxMzgxODJHYkS0AAAAD3RFWHRUaHVtYjo6U2l6ZQAwQkKUoj7sAAAAVnRFWHRUaHVtYjo6VVJJAGZpbGU6Ly8vbW50bG9nL2Zhdmljb25zLzIwMjItMDYtMjUvNGU5YzJlYjRjNmRhMjIwZDgzYjcyOTYxZmI1ZTJiY2UuaWNvLnBuZ7tNVVEAAAAASUVORK5CYII=">
  </img>
</div>

<style>
  :host {
    all: initial;
    font-size: 14px;
    font-family: Arial, sans-serif;
  }

  #videoTogetherFlyPannel {
    background-color: #ffffff !important;
    display: flex;
    flex-direction: column;
    z-index: 2147483647;
    position: fixed;
    bottom: 15px;
    right: 15px;
    width: 310px;
    height: 380px;
    text-align: center;
    border: none !important;
    box-shadow: 0 4px 20px rgba(0,0,0,0.08);
    border-radius: 16px;
    line-height: 1.2;
    overflow: hidden;
  }

  #videoTogetherFlyPannel #videoTogetherHeader {
    flex-shrink: 0;
    cursor: move;
    touch-action: none;
    align-items: center;
    display: flex;
  }

  .vt-modal-content {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  .vt-modal-body {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    overflow: hidden;
    font-size: 14px;
    color: black;
    background-size: cover;
    padding: 6px;
    box-sizing: border-box;
  }

  .vt-modal-body > #mainPannel {
    flex: 1;
    min-height: 0;
    overflow: hidden;
    display: flex;
    flex-direction: column;
  }

  .vt-modal-close-x {
    line-height: 46px;
    text-align: center;
    text-transform: none;
    text-rendering: auto;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .vt-modal-close-x:hover {
    color: #1890ff;
  }

  .error-button {
    color: #ff6f72;
  }

  .error-button:hover {
    color: red;
  }

  .vt-modal-header {
    display: flex;
    padding: 4px 8px;
    color: #000000d9;
    background: #fff;
    border-bottom: 1px solid #f0f0f0;
    border-radius: 16px 16px 0 0;
    align-items: center;
    height: 36px;
    box-sizing: border-box;
    gap: 2px;
  }

  .vt-modal-title {
    margin: 0;
    margin-left: 6px;
    margin-right: 4px;
    color: #000000d9;
    font-weight: 500;
    font-size: 14px;
    line-height: 22px;
    word-wrap: break-word;
    flex-shrink: 0;
  }

  .vt-modal-body {
    height: calc(100% - 36px - 140px);
    min-height: 180px;
    display: flex;
    flex-direction: column;
    align-items: center;
    overflow: hidden;
    font-size: 14px;
    color: black;
    background-size: cover;
    padding: 12px;
    box-sizing: border-box;
  }

  .vt-modal-body > #mainPannel {
    height: 100%;
    overflow: hidden;
  }

  .vt-modal-footer {
    padding: 8px 12px;
    text-align: center;
    background: transparent;
    border-top: 1px solid #f0f0f0;
    display: flex;
    flex-direction: column;
    gap: 6px;
    flex-shrink: 0;
    box-sizing: border-box;
  }

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
    height: 26px;
    padding: 0 8px;
    font-size: 12px;
    border-radius: 8px;
    color: #000000d9;
    border-color: #d9d9d9;
    background: #fff;
    outline: 0;
    box-sizing: border-box;
  }

  .vt-btn span {
    line-height: 26px;
  }

  #textMessageInput {
    border-radius: 8px;
    padding: 0 12px;
    border: 1px solid #d9d9d9;
    font-size: 14px;
    box-sizing: border-box;
  }

  #textMessageInput:focus {
    border-color: #1890ff;
    outline: none;
  }

  .vt-btn:hover {
    border-color: #e3e5e7 !important;
    background-color: #e3e5e7 !important;
  }

  .vt-btn-primary {
    color: #fff;
    border-color: #1890ff;
    background: #1890ff !important;
  }

  .vt-btn-primary:hover {
    border-color: #6ebff4 !important;
    background-color: #6ebff4 !important;
  }

  .vt-btn-secondary {
    color: #fff;
    border-color: #23d591;
    background: #23d591 !important;
  }

  .vt-btn-secondary:hover {
    border-color: #8af0bf !important;
    background-color: #8af0bf !important;
  }

  .vt-btn-dangerous {
    color: #fff;
    border-color: #ff4d4f;
    background-color: #ff4d4f;
    height: 34px !important;
    padding: 0 14px !important;
    font-size: 14px !important;
    line-height: 34px !important;
    border-radius: 10px !important;
    min-width: auto !important;
    box-sizing: border-box !important;
  }

  .vt-btn-dangerous:hover {
    border-color: #f77173 !important;
    background-color: #f77173 !important;
  }

  .vt-btn-dangerous span {
    line-height: 34px !important;
  }

  .vt-modal-content-item {
    cursor: pointer;
    box-shadow: 0px 1px 4px 0px rgba(0, 0, 0, 0.16);
    padding: 0 12px;
    width: 45%;
    height: 60px;
    margin-bottom: 12px;
    display: flex;
    align-items: center;
  }

  .vt-modal-content-item:hover {
    background-color: #efefef;
  }

  #videoTogetherSamllIcon {
    z-index: 2147483647;
    position: fixed;
    bottom: 15px;
    right: 15px;
    text-align: center;
  }

  #videoTogetherRoomNameLabel,
  #videoTogetherRoomPasswordLabel {
    display: inline-block;
    width: 76px;
  }

  #videoTogetherRoomNameInput:disabled {
    border: none;
    background-color: transparent;
    color: black;
  }

  #videoTogetherRoomNameInput,
  #videoTogetherRoomPdIpt {
    width: auto;
    height: auto;
    font-family: inherit;
    font-size: inherit;
    display: inline-block;
    padding: 0;
    color: #00000073;
    background-color: #ffffff;
    border: 1px solid #e9e9e9;
    margin: 0;
  }

  .lds-ellipsis {
    display: inline-block;
    position: relative;
    width: 80px;
    height: 32px;
  }

  .lds-ellipsis div {
    position: absolute;
    top: 8px;
    width: 13px;
    height: 13px;
    border-radius: 50%;
    background: #6c6c6c;
    animation-timing-function: cubic-bezier(0, 1, 1, 0);
  }

  .lds-ellipsis div:nth-child(1) {
    left: 8px;
    animation: lds-ellipsis1 0.6s infinite;
  }

  .lds-ellipsis div:nth-child(2) {
    left: 8px;
    animation: lds-ellipsis2 0.6s infinite;
  }

  .lds-ellipsis div:nth-child(3) {
    left: 32px;
    animation: lds-ellipsis2 0.6s infinite;
  }

  .lds-ellipsis div:nth-child(4) {
    left: 56px;
    animation: lds-ellipsis3 0.6s infinite;
  }

  @keyframes lds-ellipsis1 {
    0% {
      transform: scale(0);
    }

    100% {
      transform: scale(1);
    }
  }

  @keyframes lds-ellipsis3 {
    0% {
      transform: scale(1);
    }

    100% {
      transform: scale(0);
    }
  }

  @keyframes lds-ellipsis2 {
    0% {
      transform: translate(0, 0);
    }

    100% {
      transform: translate(24px, 0);
    }
  }




  .range-slider {
    margin: 0px 0 0 0px;
    display: inline-block;
  }

  .range-slider {
    width: 130px
  }

  .slider {
    -webkit-appearance: none;
    width: calc(100% - (0px));
    height: 5px;
    border-radius: 5px;
    background: #d7dcdf;
    outline: none;
    padding: 0;
    margin: 0;
  }

  .slider::-webkit-slider-thumb {
    -webkit-appearance: none;
    appearance: none;
    width: 10px;
    height: 10px;
    border-radius: 50%;
    background: #2c3e50;
    cursor: pointer;
    -webkit-transition: background 0.15s ease-in-out;
    transition: background 0.15s ease-in-out;
  }

  .slider::-moz-range-progress {
    background-color: #1abc9c;
  }

  .slider::-webkit-slider-thumb:hover {
    background: #1abc9c;
  }

  .slider:active::-webkit-slider-thumb {
    background: #1abc9c;
  }

  .slider::-moz-range-thumb {
    width: 10px;
    height: 10px;
    border: 0;
    border-radius: 50%;
    background: #2c3e50;
    cursor: pointer;
    -moz-transition: background 0.15s ease-in-out;
    transition: background 0.15s ease-in-out;
  }

  .slider::-moz-range-thumb:hover {
    background: #1abc9c;
  }

  .slider:active::-moz-range-thumb {
    background: #1abc9c;
  }

  ::-moz-range-track {
    background: #d7dcdf;
    border: 0;
  }

  input::-moz-focus-inner,
  input::-moz-focus-outer {
    border: 0;
  }



  .toggler-wrapper {
    display: inline-block;
    width: 45px;
    height: 20px;
    cursor: pointer;
    position: relative;
  }

  .toggler-wrapper input[type="checkbox"] {
    display: none;
  }

  .toggler-wrapper input[type="checkbox"]:checked+.toggler-slider {
    background-color: #1abc9c;
  }

  .toggler-wrapper .toggler-slider {
    margin-top: 4px;
    background-color: #ccc;
    position: absolute;
    border-radius: 100px;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    -webkit-transition: all 300ms ease;
    transition: all 300ms ease;
  }

  .toggler-wrapper .toggler-knob {
    position: absolute;
    -webkit-transition: all 300ms ease;
    transition: all 300ms ease;
  }

  .toggler-wrapper.style-1 input[type="checkbox"]:checked+.toggler-slider .toggler-knob {
    left: calc(100% - 16px - 3px);
  }

  .toggler-wrapper.style-1 .toggler-knob {
    width: calc(20px - 6px);
    height: calc(20px - 6px);
    border-radius: 50%;
    left: 3px;
    top: 3px;
    background-color: #fff;
  }


  #snackbar {
    visibility: hidden;
    width: auto;
    min-width: 200px;
    max-width: 320px;
    background-color: rgba(30, 30, 30, 0.9);
    backdrop-filter: blur(10px);
    color: #fff;
    text-align: center;
    padding: 12px 20px;
    border-radius: 10px;
    position: fixed;
    bottom: 20px;
    left: 50%;
    transform: translateX(-50%) translateY(100px);
    z-index: 999999;
    box-shadow: 0 4px 12px rgba(0,0,0,0.25);
    font-size: 13px;
  }

  #snackbar.show {
    visibility: visible;
    animation: slideUpFadeOut 2s ease-out forwards;
  }

  @keyframes slideUpFadeOut {
    0% { opacity: 0; transform: translateX(-50%) translateY(100px); }
    10% { opacity: 1; transform: translateX(-50%) translateY(0); }
    75% { opacity: 1; transform: translateX(-50%) translateY(0); }
    100% { opacity: 0; transform: translateX(-50%) translateY(-20px); }
  }

  #downloadProgress {
    display: flex;
    flex-direction: column;
    width: 80%;
    align-items: center;
    margin: auto;
  }

  #speedAndStatus {
    display: flex;
    justify-content: space-between;
  }

  #downloadPannel {
    display: flex;
    flex-direction: column;
    width: 100%;
    height: 100%;
    justify-content: space-between;
  }

  #downloadVideoInfo {
    display: block;
  }

  .ellipsis {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

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
  .nickname-edit-row {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 6px 8px;
    background: #fafafa;
    border-bottom: 1px solid #f0f0f0;
  }
  .nickname-edit-row input {
    padding: 4px 8px;
    border: 1px solid #d9d9d9;
    border-radius: 4px;
    font-size: 12px;
    outline: none;
  }
  .nickname-edit-row input:focus {
    border-color: #1890ff;
  }
  .nickname-btn {
    display: flex;
    align-items: center;
    gap: 2px;
    padding: 2px 6px;
    background: #f5f5f5;
    border-radius: 6px;
    cursor: pointer;
    font-size: 12px;
    color: #000000d9;
    border: none;
    transition: background 0.2s;
    white-space: nowrap;
  }
  .nickname-btn:hover {
    background: #e8e8e8;
  }

  .vt-modal-audio,
  .vt-modal-mic {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 4px;
    color: #000000d9;
  }

  .vt-modal-audio svg,
  .vt-modal-mic svg {
    flex-shrink: 0;
    color: inherit;
  }

  #micIconNoSlash {
    display: block;
  }

  #micIconWithSlash {
    display: none;
  }

  .vt-modal-mic.muted #micIconWithSlash {
    display: block !important;
  }

  .vt-modal-mic.muted #micIconNoSlash {
    display: none !important;
  }

  .vt-modal-mic:not(.muted) #micIconWithSlash {
    display: none !important;
  }

  .vt-modal-mic:not(.muted) #micIconNoSlash {
    display: block !important;
  }
</style>`);
                (document.body || document.documentElement).appendChild(shadowWrapper);

                wrapper.querySelector("#videoTogetherMinimize").onclick = () => { this.Minimize() }
                wrapper.querySelector("#videoTogetherMaximize").onclick = () => { this.Maximize() }
                ["", "webkit"].forEach(prefix => {
                    document.addEventListener(prefix + "fullscreenchange", (event) => {
                        if (document.fullscreenElement || document.webkitFullscreenElement) {
                            hide(this.videoTogetherFlyPannel);
                            hide(this.videoTogetherSamllIcon);
                        } else {
                            if (this.minimized) {
                                this.Minimize();
                            } else {
                                this.Maximize();
                            }
                        }
                    });
                });
                wrapper.querySelector("#textMessageInput").addEventListener("keyup", e => {
                    if (e.key == "Enter") {
                        wrapper.querySelector("#textMessageSend").click();
                    }
                });
                wrapper.querySelector("#textMessageSend").onclick = async () => {
                    extension.currentSendingMsgId = generateUUID();
                    const nickname = await getNickname();
                    const content = select("#textMessageInput").value;
                    const wrappedMsg = wrapMessage(nickname, content);
                    WS.sendTextMessage(extension.currentSendingMsgId, wrappedMsg);
                }

                // TTS 按钮
                const ttsBtn = wrapper.querySelector("#ttsBtn");
                if (ttsBtn) {
                    let ttsEnabled = window.VideoTogetherStorage?.PublicEnableTTS !== false;
                    const updateTtsBtnStyle = () => {
                        ttsBtn.style.backgroundColor = ttsEnabled ? "#1890ff" : "#999";
                        ttsBtn.style.color = "#fff";
                        ttsBtn.style.borderColor = ttsEnabled ? "#1890ff" : "#999";
                    };
                    updateTtsBtnStyle();
                    ttsBtn.addEventListener("click", (e) => {
                        e.stopPropagation();
                        ttsEnabled = !ttsEnabled;
                        if (window.VideoTogetherStorage) {
                            window.VideoTogetherStorage.PublicEnableTTS = ttsEnabled;
                            sendMessageToTop(MessageType.SetStorageValue, { key: "PublicEnableTTS", value: ttsEnabled });
                        }
                        updateTtsBtnStyle();
                    });
                }

                // 非全屏模式的 GotTxtMsgCallback
                GotTxtMsgCallback = async (id, msg) => {
                    console.log(id, msg);
                    const parsed = parseMessage(msg);
                    const roomId = extension.roomName || "default";
                    const isSelf = id == extension.currentSendingMsgId;

                    // 存储到历史记录
                    await addMessageToHistory(roomId, parsed.sender, parsed.content, isSelf);

                    // 渲染到 UI
                    const chatHistoryEl = select("#chatHistory");
                    if (chatHistoryEl) {
                        renderChatMessage(chatHistoryEl, parsed.sender, parsed.content, isSelf);
                    }

                    // 气泡通知（仅接收方，面板收起时显示）
                    if (!isSelf) {
                        const chatHistoryEl = select("#chatHistory");
                        if (!chatHistoryEl || chatHistoryEl.offsetParent === null) {
                            this.showBubbleNotification(parsed.sender, parsed.content, document.body, null);
                        }
                    }

                    // TTS（发送人自己不发TTS）
                    if (!isSelf) {
                        extension.gotTextMsg(id, parsed.content, false, -1);
                    }

                    if (isSelf) {
                        const msgInput = select("#textMessageInput");
                        if (msgInput) msgInput.value = "";
                    }
                }

                this.lobbyBtnGroup = wrapper.querySelector("#lobbyBtnGroup");
                this.createRoomButton = wrapper.querySelector('#videoTogetherCreateButton');
                this.joinRoomButton = wrapper.querySelector("#videoTogetherJoinButton");
                this.roomButtonGroup = wrapper.querySelector('#roomButtonGroup');
                this.exitButton = wrapper.querySelector("#videoTogetherExitButton");
                this.callBtn = wrapper.querySelector("#callBtn");
                this.callBtn.onclick = () => Voice.join("", window.videoTogetherExtension.roomName);
                this.audioBtn = wrapper.querySelector("#audioBtn");
                this.micBtn = wrapper.querySelector("#micBtn");
                this.videoVolume = wrapper.querySelector("#videoVolume");
                this.callVolumeSlider = wrapper.querySelector("#callVolume");
                this.callErrorBtn = wrapper.querySelector("#callErrorBtn");
                this.chatHistoryBtn = wrapper.querySelector("#chatHistoryBtn");
                this.chatHistoryBtnRoom = wrapper.querySelector("#chatHistoryBtnRoom");
                this.easyShareCopyBtn = wrapper.querySelector("#easyShareCopyBtn");
                this.textMessageChat = wrapper.querySelector("#textMessageChat");
                this.chatInputRow = wrapper.querySelector("#chatInputRow");
                this.textMessageConnecting = wrapper.querySelector("#textMessageConnecting");
                this.textMessageConnectingStatus = wrapper.querySelector("#textMessageConnectingStatus");
                this.zhcnTtsMissing = wrapper.querySelector("#zhcnTtsMissing");
                this.downloadBtn = wrapper.querySelector("#downloadBtn");
                this.initNicknameDropdown();
                hide(this.downloadBtn);
                this.confirmDownloadBtn = wrapper.querySelector("#confirmDownloadBtn")
                this.confirmDownloadBtn.onclick = () => {
                    if (extension.downloadM3u8UrlType == "video") {
                        extension.Fetch(extension.video_together_host + "/beta/counter?key=confirm_video_download")
                        console.log(extension.downloadM3u8Url, extension.downloadM3u8UrlType)
                        sendMessageToTop(MessageType.SetStorageValue, {
                            key: "PublicNextDownload", value: {
                                filename: document.title + '.mp4',
                                url: extension.downloadM3u8Url
                            }
                        });
                        const a = document.createElement("a");
                        a.href = extension.downloadM3u8Url;
                        a.target = "_blank";
                        a.download = document.title + ".mp4";
                        a.click();
                        return;
                    }
                    extension.Fetch(extension.video_together_host + "/beta/counter?key=confirm_m3u8_download")
                    isDownloading = true;
                    const m3u8url = extension.downloadM3u8Url
                    sendMessageTo(extension.m3u8PostWindows[extension.GetM3u8WindowId(m3u8url)], MessageType.StartDownload, {
                        m3u8Url: m3u8url,
                        m3u8Content: extension.GetM3u8Content(m3u8url),
                        urls: extension.GetAllM3u8SegUrls(m3u8url),
                        title: document.title,
                        pageUrl: window.location.href
                    });

                    hide(this.confirmDownloadBtn);
                    show(select("#downloadProgress"));
                }
                this.downloadBtn.onclick = () => {
                    setInterval(() => {
                        if (isDownloading) {
                            return;
                        }
                        if (extension.downloadM3u8Url != undefined) {
                            show(this.confirmDownloadBtn);
                            select('#downloadVideoInfo').innerText = getDurationStr(extension.downloadDuration);
                        } else {
                            hide(this.confirmDownloadBtn);
                            select('#downloadVideoInfo').innerText = "Detecting video..."
                        }
                    }, 1000);
                    inDownload = true;
                    this.inputRoomName.value = "download_" + generateUUID();
                    this.createRoomButton.click()
                    hide(select('.vt-modal-footer'))
                    hide(select('#mainPannel'))
                    show(select('#downloadPannel'))
                }
                this.easyShareCopyBtn.onclick = async () => {
                    try {
                        if (isWeb()) {
                            await navigator.clipboard.writeText(extension.linkWithMemberState(window.location, extension.RoleEnum.Member, false))
                        } else {
                            let shareText = 'Click the link to watch together with me: <main_share_link>';
                            shareText = shareText.replace("<main_share_link>", await extension.generateEasyShareLink())
                            if (shareText.indexOf("<china_share_link>") != -1) {
                                shareText = shareText.replace("<china_share_link>", await extension.generateEasyShareLink(true))
                            }
                            await navigator.clipboard.writeText(shareText);
                        }
                        popupError("Copied");
                    } catch {
                        popupError("Copy failed");
                    }
                }
                this.callErrorBtn.onclick = () => {
                    Voice.join("", window.videoTogetherExtension.roomName);
                }
                this.chatHistoryBtn.onclick = async () => {
                    const history = await getChatHistory();
                    const roomIds = Object.keys(history).filter(k => history[k]?.messages?.length > 0);

                    // 创建模态框
                    const modal = document.createElement("div");
                    modal.style.cssText = `
                        position: fixed; top: 0; left: 0; right: 0; bottom: 0;
                        background: rgba(0,0,0,0.5); z-index: 2147483647;
                        display: flex; align-items: center; justify-content: center;
                    `;

                    const modalContent = document.createElement("div");
                    modalContent.style.cssText = `
                        background: #fff; border-radius: 12px; padding: 20px;
                        max-width: 500px; max-height: 80vh; overflow-y: auto;
                        color: #1a1a1a; font-size: 14px; width: 90%;
                        box-shadow: 0 8px 32px rgba(0,0,0,0.2);
                    `;

                    modalContent.innerHTML = `
                        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 15px;">
                            <h3 style="margin: 0; color: #1a1a1a;">Chat History Manager</h3>
                            <button id="modal-close-btn" style="
                                background: transparent; border: none; color: #666;
                                font-size: 24px; cursor: pointer; padding: 0 5px; line-height: 1;
                            ">×</button>
                        </div>
                        <div id="room-list"></div>
                    `;

                    modal.appendChild(modalContent);
                    document.body.appendChild(modal);

                    const roomList = modalContent.querySelector("#room-list");
                    const closeModal = () => modal.remove();
                    modalContent.querySelector("#modal-close-btn").onclick = closeModal;
                    modal.onclick = (e) => { if (e.target === modal) closeModal(); };

                    if (roomIds.length === 0) {
                        roomList.innerHTML = `<div style="text-align: center; color: #999; padding: 30px;">No chat history</div>`;
                        return;
                    }

                    roomIds.forEach(roomId => {
                        const room = history[roomId];
                        const msgCount = room.messages.length;
                        const lastTime = room.lastActivity ? new Date(room.lastActivity).toLocaleString() : "-";

                        const roomItem = document.createElement("div");
                        roomItem.style.cssText = `
                            background: #f5f5f5; border-radius: 8px; padding: 12px; margin-bottom: 10px;
                            border: 1px solid #e0e0e0;
                        `;
                        roomItem.innerHTML = `
                            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
                                <div>
                                    <div style="font-weight: 600; color: #1890ff; word-break: break-all;">${escapeHtml(roomId)}</div>
                                    <div style="font-size: 12px; color: #888;">${msgCount} 条消息 | ${lastTime}</div>
                                </div>
                            </div>
                            <div id="preview-${roomId}" style="display: none; background: #fff; border-radius: 6px; padding: 10px; margin-bottom: 10px; max-height: 200px; overflow-y: auto; border: 1px solid #ddd;"></div>
                            <div style="display: flex; gap: 8px;">
                                <button class="preview-btn" data-room="${roomId}" style="
                                    flex: 1; padding: 8px; border: none; border-radius: 6px;
                                    background: #1890ff; color: #fff; cursor: pointer; font-weight: 500;
                                ">Preview</button>
                                <button class="export-btn" data-room="${roomId}" style="
                                    flex: 1; padding: 8px; border: none; border-radius: 6px;
                                    background: #52c41a; color: #fff; cursor: pointer;
                                ">Export</button>
                                <button class="delete-btn" data-room="${roomId}" style="
                                    flex: 1; padding: 8px; border: none; border-radius: 6px;
                                    background: #ff4d4f; color: #fff; cursor: pointer;
                                ">Delete</button>
                            </div>
                        `;
                        roomList.appendChild(roomItem);

                        // 预览按钮
                        roomItem.querySelector(".preview-btn").onclick = function() {
                            const previewEl = roomItem.querySelector(`#preview-${roomId}`);
                            const btn = roomItem.querySelector(".preview-btn");
                            if (previewEl.style.display === "none") {
                                previewEl.style.display = "block";
                                previewEl.innerHTML = room.messages.map(m =>
                                    `<div style="margin-bottom: 8px; padding-bottom: 8px; border-bottom: 1px solid #eee;">
                                        <span style="color: ${m.isSelf ? '#1890ff' : '#fa8c16'};font-weight:600;">${escapeHtml(m.sender)}</span>
                                        <span style="color: #666; margin-left: 8px;">${escapeHtml(m.content)}</span>
                                        <div style="font-size: 11px; color: #999; margin-top: 4px;">${m.timestamp ? new Date(m.timestamp).toLocaleString() : ''}</div>
                                    </div>`
                                ).join('');
                                btn.textContent = "Close";
                                btn.style.background = "#999";
                            } else {
                                previewEl.style.display = "none";
                                btn.textContent = "Preview";
                                btn.style.background = "#1890ff";
                            }
                        };

                        // 导出按钮
                        roomItem.querySelector(".export-btn").onclick = function() {
                            const text = room.messages.map(m =>
                                `[${m.timestamp ? new Date(m.timestamp).toLocaleString() : ''}] ${m.sender}: ${m.content}`
                            ).join('\n');
                            const blob = new Blob([text], { type: 'text/plain' });
                            const url = URL.createObjectURL(blob);
                            const a = document.createElement('a');
                            a.href = url;
                            a.download = `chat_history_${roomId}_${Date.now()}.txt`;
                            a.click();
                            URL.revokeObjectURL(url);
                            popupError("Exported to clipboard");
                        };

                        // 删除按钮
                        roomItem.querySelector(".delete-btn").onclick = function() {
                            if (confirm("Are you sure you want to delete this room's chat history?")) {
                                delete history[roomId];
                                saveChatHistory(history);
                                roomItem.remove();
                                if (roomList.children.length === 0) {
                                    roomList.innerHTML = `<div style="text-align: center; color: #999; padding: 30px;">No chat history</div>`;
                                }
                            }
                        };
                    });
                }
                this.chatHistoryBtnRoom.onclick = this.chatHistoryBtn.onclick;
                this.videoVolume.oninput = () => {
                    extension.videoVolume = this.videoVolume.value;
                    sendMessageToTop(MessageType.ChangeVideoVolume, { volume: extension.getVideoVolume() / 100 });
                }
                this.callVolumeSlider.oninput = () => {
                    extension.voiceVolume = this.callVolumeSlider.value;
                    [...select('#peer').querySelectorAll("*")].forEach(e => {
                        e.volume = extension.getVoiceVolume() / 100;
                    });
                }
                initRangeSlider(this.videoVolume);
                initRangeSlider(this.callVolumeSlider);
                this.audioBtn.onclick = async () => {
                    let hideMain = select('#mainPannel').style.display == 'none';

                    dsply(select('#mainPannel'), hideMain);
                    dsply(select('#voicePannel'), !hideMain);
                    if (!hideMain) {
                        this.audioBtn.style.color = '#1890ff';
                    } else {
                        this.audioBtn.style.color = '#6c6c6c';
                    }
                    if (await isAudioVolumeRO()) {
                        show(select('#iosVolumeErr'));
                        hide(select('#videoVolumeCtrl'));
                        hide(select('#callVolumeCtrl'));
                    }
                }
                this.micBtn.onclick = async () => {
                    switch (Voice.status) {
                        case VoiceStatus.STOP: {
                            // TODO need fix
                            await Voice.join();
                            break;
                        }
                        case VoiceStatus.UNMUTED: {
                            Voice.mute();
                            break;
                        }
                        case VoiceStatus.MUTED: {
                            Voice.unmute();
                            break;
                        }
                    }
                }

                this.createRoomButton.onclick = this.CreateRoomButtonOnClick.bind(this);
                this.joinRoomButton.onclick = this.JoinRoomButtonOnClick.bind(this);
                this.exitButton.onclick = (() => {
                    window.videoTogetherExtension.exitRoom();
                });
                this.videoTogetherRoleText = wrapper.querySelector("#videoTogetherRoleText")
                this.videoTogetherSetting = wrapper.querySelector("#videoTogetherSetting");
                this.roomNameDisplay = wrapper.querySelector("#roomNameDisplay");
                this.roomInputContainer = wrapper.querySelector("#roomInputContainer");
                hide(this.videoTogetherSetting);
                this.inputRoomName = wrapper.querySelector('#videoTogetherRoomNameInput');
                this.inputRoomPassword = wrapper.querySelector("#videoTogetherRoomPdIpt");
                this.inputRoomNameLabel = wrapper.querySelector('#videoTogetherRoomNameLabel');
                this.inputRoomPasswordLabel = wrapper.querySelector("#videoTogetherRoomPasswordLabel");
                this.videoTogetherHeader = wrapper.querySelector("#videoTogetherHeader");
                this.videoTogetherFlyPannel = wrapper.getElementById("videoTogetherFlyPannel");
                this.videoTogetherSamllIcon = wrapper.getElementById("videoTogetherSamllIcon");

                this.volume = 1;
                this.statusText = wrapper.querySelector("#videoTogetherStatusText");
                this.InLobby(true);
                this.Init();
                setInterval(() => {
                    this.ShowPannel();
                }, 1000);
            }

            try {
                document.querySelector("#videoTogetherLoading").remove()
            } catch { }
        }

        ShowTxtMsgTouchPannel() {
            try {
                function exitFullScreen() {
                    if (document.exitFullscreen) {
                        document.exitFullscreen();
                    } else if (document.webkitExitFullscreen) { /* Safari */
                        document.webkitExitFullscreen();
                    } else if (document.mozCancelFullScreen) { /* Firefox */
                        document.mozCancelFullScreen();
                    }
                }
                exitFullScreen();
            } catch { }
            try {
                this.txtMsgTouchPannel.remove();
            } catch { }
            this.txtMsgTouchPannel = document.createElement('div');
            let touch = this.txtMsgTouchPannel;
            touch.id = "videoTogetherTxtMsgTouch";
            touch.style.width = "100%";
            touch.style.height = "100%";
            touch.style.position = "fixed";
            touch.style.top = "0";
            touch.style.left = "0";
            touch.style.zIndex = "2147483647";
            touch.style.background = "#fff";
            touch.style.display = "flex";
            touch.style.justifyContent = "center";
            touch.style.alignItems = "center";
            touch.style.padding = "0px";
            touch.style.flexDirection = "column";
            touch.style.lineHeight = "40px";
            AttachShadow(this.txtMsgTouchPannel, { mode: "open" })
            touch.addEventListener('click', function () {
                windowPannel.enableSpeechSynthesis();
                document.body.removeChild(touch);
                windowPannel.txtMsgTouchPannel = undefined;
            });
            document.body.appendChild(touch);

            this.setTxtMsgTouchPannelText("VideoTogether: You got a new message, click the screen to receive");
        }

        setTxtMsgInterface(type) {
            hide(this.textMessageChat);
            hide(this.chatInputRow);
            hide(this.textMessageConnecting);
            hide(this.textMessageConnectingStatus);
            hide(this.zhcnTtsMissing);
            if (type == 0) {

            }
            if (type == 1) {
                show(this.textMessageChat);
                show(this.chatInputRow);
                // 加载聊天历史
                this.loadChatHistory();
            }
            if (type == 2) {
                show(this.textMessageConnecting);
                this.textMessageConnectingStatus.innerText = "Connecting to Message service..."
                show(this.textMessageConnectingStatus);
            }
            if (type == 3) {
                show(this.textMessageConnecting);
                show(this.zhcnTtsMissing);
            }
            if (type == 4) {
                show(this.textMessageConnecting);
                this.textMessageConnectingStatus.innerText = "Text Message is disabled"
                show(this.textMessageConnectingStatus);
            }
        }

        loadChatHistory() {
            const chatHistoryEl = select("#chatHistory");
            if (!chatHistoryEl) return;
            const roomId = extension.roomName || "default";
            getRoomChatHistory(roomId).then(messages => {
                // Only load if chat is empty (avoid clearing newly rendered messages)
                if (chatHistoryEl.children.length === 0) {
                    messages.forEach(msg => {
                        renderChatMessage(chatHistoryEl, msg.sender, msg.content, msg.isSelf);
                    });
                }
            }).catch(() => {});
        }

        initNicknameDropdown() {
            if (!this.wrapper) return;

            // Use window.getGM if available, otherwise fall back to browser.storage.local or GM
            console.log("initNicknameDropdown checking storage:");
            console.log("  window.getGM exists:", !!window.getGM);
            console.log("  browser exists:", typeof browser !== 'undefined');

            let storage = null;
            if (window.getGM) {
                storage = window.getGM();
            } else if (typeof browser !== 'undefined' && browser && browser.storage && browser.storage.local) {
                storage = browser.storage.local;
            } else if (typeof GM !== 'undefined') {
                storage = GM;
            } else {
                // Fallback to localStorage
                storage = {
                    get: async (key) => {
                        const value = localStorage.getItem(key);
                        return value ? JSON.parse(value) : null;
                    },
                    set: async (key, value) => {
                        localStorage.setItem(key, JSON.stringify(value));
                    }
                };
            }

            console.log("initNicknameDropdown storage:", storage);

            const nicknameBtn = this.wrapper.querySelector("#nicknameBtn");
            const nicknameText = this.wrapper.querySelector("#nicknameText");
            const nicknameEditRow = this.wrapper.querySelector("#nicknameEditRow");
            const nicknameInput = this.wrapper.querySelector("#nicknameInput");
            const saveNicknameBtn = this.wrapper.querySelector("#saveNicknameBtn");
            const cancelNicknameEditBtn = this.wrapper.querySelector("#cancelNicknameEditBtn");

            if (!nicknameBtn || !nicknameEditRow) return;

            // Load saved nickname
            if (storage) {
                storage.get("ChatNickname").then(result => {
                    if (result && result.ChatNickname) {
                        nicknameText.textContent = result.ChatNickname;
                    }
                });
            }

            // Click nickname button to show edit row
            nicknameBtn.addEventListener("click", () => {
                nicknameEditRow.style.display = nicknameEditRow.style.display === "none" ? "flex" : "none";
                if (nicknameEditRow.style.display === "flex") {
                    nicknameInput.value = nicknameText.textContent === "匿名用户" ? "" : nicknameText.textContent;
                    nicknameInput.focus();
                }
            });

            // Cancel nickname edit
            cancelNicknameEditBtn.addEventListener("click", () => {
                nicknameEditRow.style.display = "none";
            });

            // Save nickname
            saveNicknameBtn.addEventListener("click", async () => {
                const newNickname = nicknameInput.value.trim() || "匿名用户";
                console.log("Saving nickname:", newNickname, "storage:", storage);
                if (storage) {
                    await storage.set("ChatNickname", { ChatNickname: newNickname });
                    console.log("Nickname saved successfully");
                }
                nicknameText.textContent = newNickname;
                nicknameEditRow.style.display = "none";
            });

            // Save on Enter key
            nicknameInput.addEventListener("keyup", (e) => {
                if (e.key === "Enter") {
                    saveNicknameBtn.click();
                }
            });
        }

        enableSpeechSynthesis() {
            if (!extension.speechSynthesisEnabled) {
                try {
                    extension.gotTextMsg("", "", true);
                    extension.speechSynthesisEnabled = true;
                    textVoiceAudio.play();
                } catch { }
            }
        }

        setTxtMsgTouchPannelText(s) {
            let span = document.createElement('span');
            span.style.fontSize = "40px";
            span.style.lineHeight = "40px";
            span.style.color = "black";
            span.style.overflowWrap = "break-word";
            span.style.textAlign = "center";
            span.textContent = s;
            this.txtMsgTouchPannel.shadowRoot.appendChild(span);
            let voiceSelect = document.createElement('select');
            this.voiceSelect = voiceSelect;
            voiceSelect.onclick = (e) => {
                e.stopPropagation();
            }
            let label = span.cloneNode(true);
            label.textContent = "You can select the voice for reading messages:";
            this.txtMsgTouchPannel.shadowRoot.appendChild(document.createElement('br'));
            this.txtMsgTouchPannel.shadowRoot.appendChild(label);
            let voices = speechSynthesis.getVoices();
            voices.forEach(function (voice, index) {
                var option = document.createElement('option');
                option.value = voice.voiceURI;
                option.textContent = voice.name + ' (' + voice.lang + ')';
                voiceSelect.appendChild(option);
            });
            voiceSelect.oninput = (e) => {
                console.log(e);
                sendMessageToTop(MessageType.SetStorageValue, { key: "PublicMessageVoice", value: voiceSelect.value });
            }
            voiceSelect.style.fontSize = "20px";
            voiceSelect.style.height = "50px";
            voiceSelect.style.maxWidth = "100%";
            try {
                if (window.VideoTogetherStorage.PublicMessageVoice != undefined) {
                    voiceSelect.value = window.VideoTogetherStorage.PublicMessageVoice;
                } else {
                    voiceSelect.value = speechSynthesis.getVoices().find(v => v.default).voiceURI;
                }
            } catch { };
            this.txtMsgTouchPannel.shadowRoot.appendChild(voiceSelect)
        }

        ShowPannel() {
            if (!document.documentElement.contains(this.shadowWrapper)) {
                (document.body || document.documentElement).appendChild(this.shadowWrapper);
            }
        }

        Minimize(isDefault = false) {
            this.minimized = true;
            if (!isDefault) {
                this.SaveIsMinimized(true);
            }
            this.disableDefaultSize = true;
            hide(this.videoTogetherFlyPannel);
            show(this.videoTogetherSamllIcon);
        }

        Maximize(isDefault = false) {
            this.minimized = false;
            if (!isDefault) {
                this.SaveIsMinimized(false);
            }
            this.disableDefaultSize = true;
            show(this.videoTogetherFlyPannel);
            hide(this.videoTogetherSamllIcon);
        }

        SaveIsMinimized(minimized) {
            localStorage.setItem("VideoTogetherMinimizedHere", minimized ? 1 : 0)
        }

        Init() {
            let VideoTogetherMinimizedHere = localStorage.getItem("VideoTogetherMinimizedHere");
            if (VideoTogetherMinimizedHere == 0) {
                this.Maximize(true);
            } else if (VideoTogetherMinimizedHere == 1) {
                this.Minimize(true);
            }
        }

        InRoom() {
            try {
                speechSynthesis.getVoices();
            } catch { };
            this.Maximize();
            this.inputRoomName.disabled = true;
            this.inputRoomName.style.display = "none";
            this.inputRoomNameLabel.style.display = "none";
            this.roomInputContainer.style.display = "none";
            this.roomNameDisplay.style.display = "inline";
            this.roomNameDisplay.textContent = this.inputRoomName.value;
            hide(this.lobbyBtnGroup);
            show(this.roomButtonGroup);
            this.exitButton.style = "";
            hide(this.inputRoomPasswordLabel);
            hide(this.inputRoomPassword);
            this.inputRoomName.placeholder = "";
            this.isInRoom = true;
            hide(this.downloadBtn)
        }

        InLobby(init = false) {
            if (!init) {
                this.Maximize();
            }
            this.inputRoomName.disabled = false;
            this.inputRoomName.style.display = "inline";
            this.inputRoomNameLabel.style.display = "inline";
            this.roomInputContainer.style.display = "flex";
            this.roomNameDisplay.style.display = "none";
            this.inputRoomPasswordLabel.style.display = "inline-block";
            this.inputRoomPassword.style.display = "inline-block";
            this.inputRoomName.placeholder = "Name of room"
            show(this.lobbyBtnGroup);
            hide(this.roomButtonGroup);
            hide(this.easyShareCopyBtn);
            this.setTxtMsgInterface(0);
            dsply(this.downloadBtn, downloadEnabled())
            this.isInRoom = false;
        }

        CreateRoomButtonOnClick() {
            this.Maximize();
            let roomName = this.inputRoomName.value;
            let password = this.inputRoomPassword.value;
            window.videoTogetherExtension.CreateRoom(roomName, password);
        }

        JoinRoomButtonOnClick() {
            this.Maximize();
            let roomName = this.inputRoomName.value;
            let password = this.inputRoomPassword.value;
            window.videoTogetherExtension.JoinRoom(roomName, password);
        }

        HelpButtonOnClick() {
            this.Maximize();
            let url = 'https://videotogether.github.io/guide/qa.html';
            if (language == 'zh-cn') {
                url = 'https://www.bilibili.com/opus/956528691876200471';
            }
            if (vtRuntime == "website") {
                url = "https://videotogether.github.io/guide/website_qa.html";
            }
            window.open(url, '_blank');
        }

        UpdateStatusText(text, color) {
            updateInnnerHTML(this.statusText, text);
            this.statusText.style.color = color;
        }
    }

    class VideoModel {
        constructor(id, duration, activatedTime, refreshTime, priority = 0) {
            this.id = id;
            this.duration = duration;
            this.activatedTime = activatedTime;
            this.refreshTime = refreshTime;
            this.priority = priority;
        }
    }

    let MessageType = {
        ActivatedVideo: 1,
        ReportVideo: 2,
        SyncMemberVideo: 3,
        SyncMasterVideo: 4,
        UpdateStatusText: 5,
        JumpToNewPage: 6,
        GetRoomData: 7,
        ChangeVoiceVolume: 8,
        ChangeVideoVolume: 9,

        FetchRequest: 13,
        FetchResponse: 14,

        SetStorageValue: 15,
        SyncStorageValue: 16,

        ExtensionInitSuccess: 17,

        SetTabStorage: 18,
        SetTabStorageSuccess: 19,

        UpdateRoomRequest: 20,
        CallScheduledTask: 21,

        RoomDataNotification: 22,
        UpdateMemberStatus: 23,
        TimestampV2Resp: 24,
        // EasyShareCheckSucc: 25,
        FetchRealUrlReq: 26,
        FetchRealUrlResp: 27,
        FetchRealUrlFromIframeReq: 28,
        FetchRealUrlFromIframeResp: 29,
        SendTxtMsg: 30,
        GotTxtMsg: 31,
        StartDownload: 32,
        DownloadStatus: 33,


        UpdateM3u8Files: 1001,

        SaveIndexedDb: 2001,
        ReadIndexedDb: 2002,
        SaveIndexedDbResult: 2003,
        ReadIndexedDbResult: 2004,
        RegexMatchKeysDb: 2005,
        RegexMatchKeysDbResult: 2006,
        DeleteFromIndexedDb: 2007,
        DeleteFromIndexedDbResult: 2008,
        StorageEstimate: 2009,
        StorageEstimateResult: 2010,
        ReadIndexedDbSw: 2011,
        ReadIndexedDbSwResult: 2012,
        //2013 used

        IosStorageSet: 3001,
        IosStorageSetResult: 3002,
        IosStorageGet: 3003,
        IosStorageGetResult: 3004,
        IosStorageDelete: 3005,
        IosStorageDeleteResult: 3006,
        IosStorageUsage: 3007,
        IosStorageUsageResult: 3008,
        IosStorageCompact: 3009,
        IosStorageDeletePrefix: 3010,
        IosStorageDeletePrefixResult: 3011,
    }

    let VIDEO_EXPIRED_SECOND = 10

    class VideoWrapper {
        set currentTime(v) {
            this.currentTimeSetter(v);
        }
        get currentTime() {
            return this.currentTimeGetter();
        }
        set playbackRate(v) {
            this.playbackRateSetter(v);
        }
        get playbackRate() {
            return this.playbackRateGetter();
        }
        constructor(play, pause, paused, currentTimeGetter, currentTimeSetter, duration, playbackRateGetter, playbackRateSetter) {
            this.play = play;
            this.pause = pause;
            this.paused = paused;
            this.currentTimeGetter = currentTimeGetter;
            this.currentTimeSetter = currentTimeSetter;
            this.duration = duration;
            this.playbackRateGetter = playbackRateGetter;
            this.playbackRateSetter = playbackRateSetter;
        }
    }

    class VideoTogetherExtension {

        constructor() {
            this.RoleEnum = {
                Null: 1,
                Master: 2,
                Member: 3,
            }
            this.cspBlockedHost = {};

            this.video_together_host = 'https://vt.panghair.com:5000/';
            this.video_together_main_host = 'https://vt.panghair.com:5000/';
            this.video_tag_names = ["video", "bwp-video", "fake-iframe-video"]

            this.timer = 0
            this.roomName = ""
            this.roomPassword = ""
            this.role = this.RoleEnum.Null
            this.url = ""
            this.duration = undefined
            this.waitForLoadding = false;
            this.playAfterLoadding = false;
            this.minTrip = 1e9;
            this.timeOffset = 0;
            this.lastScheduledTaskTs = 0;
            this.httpSucc = false;

            this.activatedVideo = undefined;
            this.tempUser = generateTempUserId();
            this.version = '1777046977';
            this.isMain = (window.self == window.top);
            this.UserId = undefined;

            this.callbackMap = new Map;
            this.allLinksTargetModified = false;
            this.voiceVolume = null;
            this.videoVolume = null;
            this.m3u8Files = {};
            this.m3u8DurationReCal = {};
            this.m3u8UrlTestResult = {};
            this.hasCheckedM3u8Url = {};
            this.m3u8PostWindows = {};
            this.m3u8MediaUrls = {};
            this.currentM3u8Url = undefined;
            this.ctxMemberCount = 0;
            this.downloadSpeedMb = 0;
            this.downloadPercentage = 0;
            this.currentSendingMsgId = null;

            this.isIos = undefined;
            this.speechSynthesisEnabled = false;
            // we need a common callback function to deal with all message
            this.SetTabStorageSuccessCallback = () => { };
            document.addEventListener("securitypolicyviolation", (e) => {
                try {
                    let host = (new URL(e.blockedURI)).host;
                    this.cspBlockedHost[host] = true;
                } catch (e) { }
            });
            try {
                this.CreateVideoDomObserver();
            } catch { }
            this.timer = setInterval(() => this.ScheduledTask(true), 2 * 1000);
            this.videoMap = new Map();
            let messageListenerAliveCount = 0;
            const messageListener = message => {
                messageListenerAliveCount++;
                if (message.data.context) {
                    this.tempUser = message.data.context.tempUser;
                    this.videoTitle = message.data.context.videoTitle;
                    this.voiceStatus = message.data.context.voiceStatus;
                    this.timeOffset = message.data.context.timeOffset;
                    this.ctxRole = message.data.context.ctxRole;
                    this.ctxMemberCount = message.data.context.ctxMemberCount;
                    this.ctxWsIsOpen = message.data.context.ctxWsIsOpen;
                    // sub frame has 2 storage data source, top frame or extension.js in this frame
                    // this 2 data source should be same.
                    window.VideoTogetherStorage = message.data.context.VideoTogetherStorage;
                }
                this.processReceivedMessage(message.data.type, message.data.data, message);
            }
            window.addEventListener('message', messageListener);
            setInterval(() => {
                const currentCount = messageListenerAliveCount;
                setTimeout(() => {
                    if (currentCount == messageListenerAliveCount) {
                        console.error("messageListener is dead");
                        window.addEventListener('message', messageListener);
                    }
                }, 6000);
            }, 1000);
            try {
                navigator.serviceWorker.addEventListener('message', (message) => {
                    console.log(`Received a message from service worker: ${event.data}`);
                    this.processReceivedMessage(message.data.type, message.data.data, message);
                });
            } catch { };

            // if some element's click be invoked frequenctly, a lot of http request will be sent
            // window.addEventListener('click', message => {
            //     setTimeout(this.ScheduledTask.bind(this), 200);
            // })

            if (this.isMain) {
                try {
                    try {
                        this.RecoveryState();
                    } catch { }
                    this.EnableDraggable();

                    setTimeout(() => {
                        let allDoms = document.querySelectorAll("*");
                        for (let i = 0; i < allDoms.length; i++) {
                            const cssObj = window.getComputedStyle(allDoms[i], null);
                            if (cssObj.getPropertyValue("z-index") == 2147483647 && !allDoms[i].id.startsWith("videoTogether")) {
                                allDoms[i].style.zIndex = 2147483646;
                            }
                        }
                    }, 2000);
                } catch (e) { console.error(e) }
            }
        }

        async gotTextMsg(id, msg, prepare = false, idx = -1, audioUrl = undefined) {
            // 检查 TTS 按钮是否启用
            const ttsBtn = select("#ttsBtn");
            if (!prepare && ttsBtn && window.VideoTogetherStorage.PublicEnableTTS == false) {
                return;
            }
            if (idx > speechSynthesis.getVoices().length) {
                return;
            }
            if (!prepare && !extension.speechSynthesisEnabled) {
                windowPannel.ShowTxtMsgTouchPannel();
                for (let i = 0; i <= 1000 && !extension.speechSynthesisEnabled; i++) {
                    await new Promise(r => setTimeout(r, 100));
                }
            }
            try {
                if (id == this.currentSendingMsgId && msg == select("#textMessageInput").value) {
                    select("#textMessageInput").value = "";
                }
            } catch { }

            // iOS cannot play audio in background
            if (!isEmpty(audioUrl) && !this.isIos) {
                textVoiceAudio.src = audioUrl;
                textVoiceAudio.play();
                return;
            }

            let ssu = new SpeechSynthesisUtterance();
            ssu.text = msg;
            ssu.volume = 1;
            ssu.rate = 1;
            ssu.pitch = 1;
            if (idx == -1) {
                try {
                    ssu.voice = speechSynthesis.getVoices().find(v => v.voiceURI == window.VideoTogetherStorage.PublicMessageVoice);
                } catch { }
            } else {
                ssu.voice = speechSynthesis.getVoices()[idx];
            }
            if (!prepare) {
                let startTs = 0;
                ssu.onstart = (e => { startTs = e.timeStamp });
                ssu.onend = (e => {
                    const duration = e.timeStamp - startTs;
                    if (duration < 100) {
                        this.gotTextMsg(id, msg, prepare, idx + 1);
                    }
                });
            }
            speechSynthesis.speak(ssu);
        }

        setRole(role) {
            let setRoleText = text => {
                updateInnnerHTML(window.videoTogetherFlyPannel.videoTogetherRoleText, text);
            }
            this.role = role
            switch (role) {
                case this.RoleEnum.Master:
                    setRoleText("Host");
                    break;
                case this.RoleEnum.Member:
                    setRoleText("Member");
                    break;
                default:
                    setRoleText("");
                    break;
            }
        }

        async generateEasyShareLink(china = false) {
            const path = `${language}/easyshare.html?VideoTogetherRole=3&VideoTogetherRoomName=${this.roomName}&VideoTogetherTimestamp=9999999999&VideoTogetherUrl=&VideoTogetherPassword=${this.password}`;
            if (china) {
                return getCdnPath(await getEasyShareHostChina(), path);
            } else {
                return getCdnPath('https://videotogether.github.io', path);
            }
        }

        async Fetch(url, method = 'GET', data = null) {
            if (!extension.isMain) {
                console.error("fetch in child");
                throw new Error("fetch in child");
            }
            url = new URL(url);
            url.searchParams.set("version", this.version);
            try {
                url.searchParams.set("language", language);
                url.searchParams.set("voiceStatus", this.isMain ? Voice.status : this.voiceStatus);
                url.searchParams.set("loaddingVersion", window.VideoTogetherStorage.LoaddingVersion);
                url.searchParams.set("runtimeType", window.VideoTogetherStorage.UserscriptType);
            } catch (e) { }
            try {
                url.searchParams.set("userId", window.VideoTogetherStorage.PublicUserId);
            } catch (e) { }
            url = url.toString();
            let host = (new URL(url)).host;
            if (this.cspBlockedHost[host] || url.startsWith('http:')) {
                let id = generateUUID()
                return await new Promise((resolve, reject) => {
                    this.callbackMap.set(id, (data) => {
                        if (data.data) {
                            resolve({ json: () => data.data, status: 200 });
                        } else {
                            reject(new Error(data.error));
                        }
                        this.callbackMap.delete(id);
                    })
                    sendMessageToTop(MessageType.FetchRequest, {
                        id: id,
                        url: url.toString(),
                        method: method,
                        data: data,
                    });
                    setTimeout(() => {
                        try {
                            if (this.callbackMap.has(id)) {
                                this.callbackMap.get(id)({ error: "timeout" });
                            }
                        } finally {
                            this.callbackMap.delete(id);
                        }
                    }, 20000);
                });
            }

            try {
                if (/\{\s+\[native code\]/.test(Function.prototype.toString.call(window.fetch))) {
                    const controller = new AbortController();
                    const timeoutId = setTimeout(() => controller.abort(), 10000);
                    return await window.fetch(url, {
                        method: method,
                        body: data == null ? undefined : JSON.stringify(data),
                        signal: controller.signal
                    });
                } else {
                    GetNativeFunction();
                    const controller = new AbortController();
                    const timeoutId = setTimeout(() => controller.abort(), 10000);
                    return await Global.NativeFetch.call(window, url, {
                        method: method,
                        body: data == null ? undefined : JSON.stringify(data),
                        signal: controller.signal
                    });
                }
            } catch (e) {
                const host = new URL(extension.video_together_host);
                const requestUrl = new URL(url);
                if (host.hostname == requestUrl.hostname) {
                    extension.httpSucc = false;
                }
                throw e;
            }
        }

        async ForEachVideo(func) {
            try {
                if (window.location.hostname.endsWith("iqiyi.com")) {
                    let video = document.querySelector('.iqp-player-videolayer-inner > video');
                    if (video != null) {
                        video.VideoTogetherChoosed = true;
                        try { await func(video) } catch { };
                    }
                }
                // disneyplus
                if (window.location.hostname.endsWith("disneyplus.com")) {
                    try {
                        let ff = document.querySelector('.ff-10sec-icon');
                        let rr = document.querySelector('.rwd-10sec-icon');
                        let video = document.querySelector('video');
                        if (ff && rr && video) {
                            if (!video.videoTogetherVideoWrapper) {
                                video.videoTogetherVideoWrapper = new VideoWrapper();
                            }
                            let videoWrapper = video.videoTogetherVideoWrapper;
                            videoWrapper.play = async () => await video.play();
                            videoWrapper.pause = async () => await video.pause();
                            videoWrapper.paused = video.paused
                            videoWrapper.currentTimeGetter = () => video.currentTime;
                            videoWrapper.currentTimeSetter = (v) => {
                                let isFf = v > video.currentTime;
                                let d = Math.abs(v - video.currentTime);
                                let clickTime = parseInt(d / 10);
                                if (clickTime > 0) {
                                    console.log(clickTime);
                                }
                                for (let i = 0; i < clickTime; i++) {
                                    isFf ? ff.click() : rr.click();
                                }
                                setTimeout(() => {
                                    isFf ? ff.click() : rr.click();
                                    if (!isVideoLoadded(video)) {
                                        console.log("loading");
                                        ff.click();
                                        rr.click();
                                    }
                                    setTimeout(() => {
                                        if (isVideoLoadded(video)) {
                                            video.currentTime = v;
                                        }
                                    }, 100);
                                }, 200);
                            }
                            videoWrapper.duration = video.duration;
                            videoWrapper.playbackRateGetter = () => video.playbackRate;
                            videoWrapper.playbackRateSetter = (v) => { video.playbackRate = v };
                            await func(videoWrapper);
                        }
                    } catch (e) { }
                }
                // Netflix
                if (window.location.hostname.endsWith("netflix.com")) {
                    try {
                        let videoPlayer = netflix.appContext.state.playerApp.getAPI().videoPlayer;
                        let player = videoPlayer.getVideoPlayerBySessionId(videoPlayer.getAllPlayerSessionIds()[0]);
                        if (!player.videoTogetherVideoWrapper) {
                            player.videoTogetherVideoWrapper = new VideoWrapper();
                        }
                        let videoWrapper = player.videoTogetherVideoWrapper;
                        videoWrapper.play = async () => await player.play();
                        videoWrapper.pause = async () => await player.pause();
                        videoWrapper.paused = player.isPaused()
                        videoWrapper.currentTimeGetter = () => player.getCurrentTime() / 1000;
                        videoWrapper.currentTimeSetter = (v) => player.seek(1000 * v);
                        videoWrapper.duration = player.getDuration() / 1000;
                        videoWrapper.playbackRateGetter = () => player.getPlaybackRate();
                        videoWrapper.playbackRateSetter = (v) => { player.setPlaybackRate(v) };
                        await func(videoWrapper);
                    } catch (e) { }
                }
                // 百度网盘
                if (window.location.host.includes('pan.baidu.com')) {
                    if (!this.BaiduPanPlayer) {
                        try {
                            if (document.querySelector('.vjs-controls-enabled').player != undefined) {
                                this.BaiduPanPlayer = document.querySelector('.vjs-controls-enabled').player;
                            }
                        } catch { }
                    }
                    if (this.BaiduPanPlayer) {
                        if (!this.BaiduPanPlayer.videoTogetherVideoWrapper) {
                            this.BaiduPanPlayer.videoTogetherVideoWrapper = new VideoWrapper();
                        }
                        let videoWrapper = this.BaiduPanPlayer.videoTogetherVideoWrapper;
                        videoWrapper.play = async () => await this.BaiduPanPlayer.play();
                        videoWrapper.pause = async () => await this.BaiduPanPlayer.pause();
                        videoWrapper.paused = this.BaiduPanPlayer.paused();
                        videoWrapper.currentTimeGetter = () => this.BaiduPanPlayer.currentTime();
                        videoWrapper.currentTimeSetter = (v) => this.BaiduPanPlayer.currentTime(v);
                        videoWrapper.duration = this.BaiduPanPlayer.duration();
                        videoWrapper.playbackRateGetter = () => this.BaiduPanPlayer.playbackRate();
                        videoWrapper.playbackRateSetter = (v) => this.BaiduPanPlayer.playbackRate(v);
                        await func(videoWrapper);
                    }
                }
            } catch (e) { }
            try {
                // 腾讯视频
                if (window.__PLAYER__ != undefined) {
                    if (window.__PLAYER__.videoTogetherVideoWrapper == undefined) {
                        window.__PLAYER__.videoTogetherVideoWrapper = new VideoWrapper();
                    }
                    let videoWrapper = window.__PLAYER__.videoTogetherVideoWrapper;
                    videoWrapper.play = async () => await window.__PLAYER__.corePlayer.play();
                    videoWrapper.pause = async () => await window.__PLAYER__.corePlayer.pause();
                    videoWrapper.paused = window.__PLAYER__.paused;
                    videoWrapper.currentTimeGetter = () => window.__PLAYER__.currentVideoInfo.playtime;
                    videoWrapper.currentTimeSetter = (v) => { if (!videoWrapper.videoTogetherPaused) { window.__PLAYER__.seek(v) } };
                    videoWrapper.duration = window.__PLAYER__.currentVideoInfo.duration;
                    videoWrapper.playbackRateGetter = () => window.__PLAYER__.playbackRate;
                    videoWrapper.playbackRateSetter = (v) => window.__PLAYER__.playbackRate = v;
                    await func(videoWrapper);
                }
            } catch (e) { };

            this.video_tag_names.forEach(async tag => {
                let videos = document.getElementsByTagName(tag);
                for (let i = 0; i < videos.length; i++) {
                    try {
                        try {
                            if (videos[i].VideoTogetherDisabled) {
                                continue;
                            }
                        } catch { };
                        try {
                            if (window.location.hostname.endsWith('bilibili.com')) {
                                if (!!videos[i].closest('div.video-page-card-small') || !!videos[i].closest('div.feed-card')) {
                                    // this is a thumbnail video
                                    continue
                                }
                            }
                        } catch { }
                        await func(videos[i]);
                    } catch (e) { console.error(e) };
                }
            });
        }

        sendMessageToSonWithContext(type, data) {
            if (this.isMain) {
                this.ctxRole = this.role;
            }
            let iframs = document.getElementsByTagName("iframe");
            for (let i = 0; i < iframs.length; i++) {
                PostMessage(iframs[i].contentWindow, {
                    source: "VideoTogether",
                    type: type,
                    data: data,
                    context: {
                        tempUser: this.tempUser,
                        videoTitle: this.isMain ? document.title : this.videoTitle,
                        voiceStatus: this.isMain ? Voice.status : this.voiceStatus,
                        VideoTogetherStorage: window.VideoTogetherStorage,
                        timeOffset: this.timeOffset,
                        ctxRole: this.ctxRole,
                        ctxMemberCount: this.ctxMemberCount,
                        ctxWsIsOpen: this.ctxWsIsOpen
                    }
                });
                // console.info("send ", type, iframs[i].contentWindow, data)
            }
        }

        async FetchRemoteRealUrl(m3u8Url, idx, originUrl) {
            if (realUrlCache[originUrl] != undefined) {
                return realUrlCache[originUrl];
            }
            if (this.isMain) {
                WS.urlReq(m3u8Url, idx, originUrl);
            } else {
                sendMessageToTop(MessageType.FetchRealUrlFromIframeReq, { m3u8Url: m3u8Url, idx: idx, origin: originUrl });
            }

            return new Promise((res, rej) => {
                let id = setInterval(() => {
                    if (realUrlCache[originUrl] != undefined) {
                        res(realUrlCache[originUrl]);
                        clearInterval(id);
                    }
                }, 200);
                setTimeout(() => {
                    clearInterval(id);
                    rej(null);
                }, 3000);
            });
        }

        async FetchRemoteM3u8Content(m3u8Url) {
            if (m3u8ContentCache[m3u8Url] != undefined) {
                return m3u8ContentCache[m3u8Url];
            }
            WS.m3u8ContentReq(m3u8Url);
            return new Promise((res, rej) => {
                let id = setInterval(() => {
                    if (m3u8ContentCache[m3u8Url] != undefined) {
                        res(m3u8ContentCache[m3u8Url]);
                        clearInterval(id);
                    }
                })
                setTimeout(() => {
                    clearInterval(id);
                    rej(null);
                }, 3000)
            })
        }

        GetM3u8Content(m3u8Url) {
            let m3u8Content = "";
            for (let id in this.m3u8Files) {
                this.m3u8Files[id].forEach(m3u8 => {
                    if (m3u8Url == m3u8.m3u8Url) {
                        m3u8Content = m3u8.m3u8Content;
                    }
                })
            }
            return m3u8Content;
        }

        GetM3u8WindowId(m3u8Url) {
            let windowId = undefined;
            for (let id in this.m3u8Files) {
                this.m3u8Files[id].forEach(m3u8 => {
                    if (m3u8Url == m3u8.m3u8Url) {
                        windowId = id;
                    }
                })
            }
            return windowId;
        }

        UrlRequest(m3u8Url, idx, origin) {
            for (let id in this.m3u8Files) {
                this.m3u8Files[id].forEach(m3u8 => {
                    if (m3u8Url == m3u8.m3u8Url) {
                        let urls = extractMediaUrls(m3u8.m3u8Content, m3u8.m3u8Url);
                        let url = urls[idx];
                        sendMessageTo(this.m3u8PostWindows[id], MessageType.FetchRealUrlReq, { url: url, origin: origin });
                    }
                })
            }
        }

        async testM3u8OrVideoUrl(testUrl) {
            const onsecuritypolicyviolation = (e) => {
                if (e.blockedURI == testUrl) {
                    // m3u8 can always be fetched, because hls.js
                    this.m3u8UrlTestResult[testUrl] = 'video'
                }
            }
            document.addEventListener("securitypolicyviolation", onsecuritypolicyviolation)
            if (this.m3u8UrlTestResult[testUrl] != undefined) {
                return this.m3u8UrlTestResult[testUrl];
            }
            function limitStream(stream, limit) {
                const reader = stream.getReader();
                let bytesRead = 0;

                return new ReadableStream({
                    async pull(controller) {
                        const { value, done } = await reader.read();

                        if (done || bytesRead >= limit) {
                            controller.close();
                            return;
                        }

                        bytesRead += value.byteLength;
                        controller.enqueue(value);
                    },

                    cancel(reason) {
                        reader.cancel(reason);
                    }
                });
            }

            return new Promise((res, rej) => {
                const rtnType = (tp) => {
                    if (this.m3u8UrlTestResult[testUrl] == undefined) {
                        this.m3u8UrlTestResult[testUrl] = tp
                    }
                    res(this.m3u8UrlTestResult[testUrl])
                }
                const abortController = new AbortController();
                VideoTogetherFetch(testUrl, { signal: abortController.signal }).then(response => {
                    const contentType = response.headers.get('Content-Type')
                    if (contentType.startsWith('video/')) {
                        rtnType('video');
                    }
                    const limitedStream = limitStream(response.body, 1024); // Limit to 1024 bytes
                    return new Response(limitedStream, { headers: response.headers });
                }).then(r => r.text())
                    .then(async txt => {
                        abortController.abort();
                        if (isM3U8(txt)) {
                            rtnType('m3u8');
                        } else {
                            rtnType('video');
                        }
                    }).catch(e => {
                        if (testUrl.startsWith('blob')) {
                            rtnType('unknown');
                        } else {
                            rtnType('video');
                        }
                    }).finally(() => {
                        document.removeEventListener("securitypolicyviolation", onsecuritypolicyviolation)
                    })
            })
        }

        // download
        GetAllM3u8SegUrls(m3u8Url) {
            for (let id in this.m3u8Files) {
                for (let mid in this.m3u8Files[id]) {
                    let m3u8 = this.m3u8Files[id][mid]
                    if (m3u8Url == m3u8.m3u8Url) {
                        return extractMediaUrls(m3u8.m3u8Content, m3u8.m3u8Url);
                    }
                }
            }
        }

        // end of download

        UpdateStatusText(text, color) {
            if (window.self != window.top) {
                sendMessageToTop(MessageType.UpdateStatusText, { text: text + "", color: color });
            } else {
                window.videoTogetherFlyPannel.UpdateStatusText(text + "", color);
            }
        }

        async processReceivedMessage(type, data, _msg) {
            let _this = this;
            // console.info("get ", type, window.location, data);
            switch (type) {
                case MessageType.CallScheduledTask:
                    this.ScheduledTask();
                    break;
                case MessageType.ActivatedVideo:
                    if (this.activatedVideo == undefined || this.activatedVideo.activatedTime < data.activatedTime) {
                        this.activatedVideo = data;
                    }
                    break;
                case MessageType.ReportVideo:
                    this.videoMap.set(data.id, data);
                    break;
                case MessageType.SyncMasterVideo:
                    this.ForEachVideo(async video => {
                        if (video.VideoTogetherVideoId == data.video.id) {
                            try {
                                await this.SyncMasterVideo(data, video);
                            } catch (e) {
                                this.UpdateStatusText(e, "red");
                            }
                        }
                    })
                    this.sendMessageToSonWithContext(type, data);
                    break;
                case MessageType.UpdateRoomRequest:
                    let m3u8Url = undefined;
                    try {
                        let d = NaN;
                        let selected = null;
                        for (let id in this.m3u8Files) {
                            this.m3u8Files[id].forEach(m3u8 => {
                                // here m3u8Url may be empty, may caused by the new response
                                // from limitedstream, but we have a new fetch after that,
                                // so we can always get the correct url.
                                if (isNaN(d) || Math.abs(data.duration - m3u8.duration) <= d) {
                                    d = Math.abs(data.duration - m3u8.duration);
                                    selected = m3u8;
                                }
                                return;
                            })
                        }
                        if (d < 3 || d / data.duration < 0.03) {
                            m3u8Url = selected.m3u8Url;
                        }
                    } catch { }
                    if (data.m3u8Url == undefined) {
                        data.m3u8Url = m3u8Url;
                    } else {
                    }// data.m3u8Url may be a video file

                    if (data.m3u8UrlType == 'video') {
                        this.downloadM3u8Url = data.m3u8Url;
                        this.downloadM3u8UrlType = 'video';
                        this.downloadDuration = data.duration;
                    } else {
                        if (m3u8Url != undefined) {
                            this.downloadM3u8Url = m3u8Url;
                            this.downloadDuration = data.duration;
                            this.downloadM3u8UrlType = 'm3u8'; // video or other
                        } else {
                            this.downloadM3u8Url = undefined;
                            this.downloadDuration = undefined;
                        }
                    }


                    if (!isEasyShareEnabled()) {
                        data.m3u8Url = "";
                    }
                    try {
                        function showEasyShareCopyBtn() {
                            if (language == 'zh-cn') {
                                getCdnConfig(encodedChinaCdnA).then(() => show(windowPannel.easyShareCopyBtn));
                            } else {
                                show(windowPannel.easyShareCopyBtn);
                            }
                        }
                        if (!isEmpty(data.m3u8Url) && isEasyShareEnabled()) {
                            this.currentM3u8Url = data.m3u8Url;
                            showEasyShareCopyBtn();
                        } else {
                            this.currentM3u8Url = undefined;
                            if (isWeb()) {
                                showEasyShareCopyBtn();
                            } else {
                                hide(windowPannel.easyShareCopyBtn);
                            }
                        }
                    } catch { };
                    try {
                        await this.UpdateRoom(data.name, data.password, data.url, data.playbackRate, data.currentTime, data.paused, data.duration, data.localTimestamp, data.m3u8Url);
                        if (this.waitForLoadding) {
                            this.UpdateStatusText("wait for memeber loading", "red");
                        } else {
                            _this.UpdateStatusText("Sync " + _this.GetDisplayTimeText(), "green");
                        }
                    } catch (e) {
                        this.UpdateStatusText(e, "red");
                    }
                    break;
                case MessageType.SyncMemberVideo:
                    this.ForEachVideo(async video => {
                        if (video.VideoTogetherVideoId == data.video.id) {
                            try {
                                await this.SyncMemberVideo(data, video);
                            } catch (e) {
                                _this.UpdateStatusText(e, "red");
                            }
                        }
                    })
                    this.sendMessageToSonWithContext(type, data);
                    break;
                case MessageType.GetRoomData:
                    this.duration = data["duration"];
                    break;
                case MessageType.UpdateStatusText:
                    window.videoTogetherFlyPannel.UpdateStatusText(data.text, data.color);
                    break;
                case MessageType.JumpToNewPage:
                    window.location = data.url;
                    let currentUrl = new URL(window.location);
                    let newUrl = new URL(data.url);
                    if (newUrl.hash != "") {
                        currentUrl.hash = "";
                        newUrl.hash = "";
                        if (currentUrl.href == newUrl.href) {
                            extension.url = data.url;
                            // window.location.reload();// for hash change
                        }
                    }
                    break;
                case MessageType.ChangeVideoVolume:
                    this.ForEachVideo(video => {
                        video.volume = data.volume;
                    });
                    this.sendMessageToSonWithContext(type, data);
                    break;
                case MessageType.FetchResponse: {
                    try {
                        this.callbackMap.get(data.id)(data);
                    } catch { };
                    break;
                }
                case MessageType.SyncStorageValue: {
                    const firstSync = (window.VideoTogetherSettingEnabled == undefined)
                    window.VideoTogetherStorage = data;
                    if (!this.isMain) {
                        return;
                    }
                    try {
                        if (window.VideoTogetherStorage.PublicNextDownload.url == window.location.href
                            && this.HasDownload != true) {
                            const a = document.createElement("a");
                            a.href = window.VideoTogetherStorage.PublicNextDownload.url;
                            a.download = window.VideoTogetherStorage.PublicNextDownload.filename;
                            a.click();
                            this.HasDownload = true;
                        }
                    } catch { }
                    try {
                        if (!this.RecoveryStateFromTab) {
                            this.RecoveryStateFromTab = true;
                            this.RecoveryState()
                        }
                    } catch (e) { };
                    try {
                        if (data.PublicMessageVoice != null && windowPannel && windowPannel.voiceSelect) {
                            windowPannel.voiceSelect.value = data.PublicMessageVoice;
                        }
                    } catch { };
                    if (window.videoTogetherFlyPannel && !window.videoTogetherFlyPannel.disableDefaultSize && firstSync) {
                        if (data.MinimiseDefault) {
                            window.videoTogetherFlyPannel.Minimize(true);
                        } else {
                            window.videoTogetherFlyPannel.Maximize(true);
                        }
                    }
                    if (typeof (data.PublicUserId) != 'string' || data.PublicUserId.length < 5) {
                        sendMessageToTop(MessageType.SetStorageValue, { key: "PublicUserId", value: generateUUID() });
                    }
                    try {
                        if (firstSync) {
                            if (!isWeb()) {
                                window.videoTogetherFlyPannel.videoTogetherSetting.href = "https://videotogether.github.io/setting/v2.html";
                                show(select('#videoTogetherSetting'));
                            } else {
                                // website
                                if (window.videoTogetherWebsiteSettingUrl != undefined) {
                                    window.videoTogetherFlyPannel.videoTogetherSetting.href = window.videoTogetherWebsiteSettingUrl;
                                    show(select('#videoTogetherSetting'));
                                }
                            }
                        }
                    } catch (e) { }
                    try {
                        dsply(select('#downloadBtn'), downloadEnabled() && !windowPannel.isInRoom)
                    } catch { }
                    window.VideoTogetherSettingEnabled = true;
                    break;
                }
                case MessageType.SetTabStorageSuccess: {
                    this.SetTabStorageSuccessCallback();
                    break;
                }
                case MessageType.RoomDataNotification: {
                    if (data['uuid'] != "") {
                        roomUuid = data['uuid'];
                    }
                    changeBackground(data['backgroundUrl']);
                    changeMemberCount(data['memberCount'])
                    break;
                }
                case MessageType.UpdateMemberStatus: {
                    WS.updateMember(this.roomName, this.password, data.isLoadding, this.url);
                    break;
                }
                case MessageType.TimestampV2Resp: {
                    let l1 = data['data']['sendLocalTimestamp'];
                    let s1 = data['data']['receiveServerTimestamp'];
                    let s2 = data['data']['sendServerTimestamp'];
                    let l2 = data['ts']
                    this.UpdateTimestampIfneeded(s1, l1, l2 - s2 + s1);
                    break;
                }
                case MessageType.UpdateM3u8Files: {
                    data['m3u8Files'].forEach(m3u8 => {
                        try {
                            function calculateM3U8Duration(textContent) {
                                let totalDuration = 0;
                                const lines = textContent.split('\n');

                                for (let i = 0; i < lines.length; i++) {
                                    if (lines[i].startsWith('#EXTINF:')) {
                                        if (i + 1 >= lines.length || lines[i + 1].startsWith('#')) {
                                            continue;
                                        }
                                        let durationLine = lines[i];
                                        let durationParts = durationLine.split(':');
                                        if (durationParts.length > 1) {
                                            let durationValue = durationParts[1].split(',')[0];
                                            let duration = parseFloat(durationValue);
                                            if (!isNaN(duration)) {
                                                totalDuration += duration;
                                            }
                                        }
                                    }
                                }
                                return totalDuration;
                            }

                            const cyrb53 = (str, seed = 0) => {
                                let h1 = 0xdeadbeef ^ seed, h2 = 0x41c6ce57 ^ seed;
                                for (let i = 0, ch; i < str.length; i++) {
                                    ch = str.charCodeAt(i);
                                    h1 = Math.imul(h1 ^ ch, 2654435761);
                                    h2 = Math.imul(h2 ^ ch, 1597334677);
                                }
                                h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
                                h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
                                h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
                                h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);

                                return 4294967296 * (2097151 & h2) + (h1 >>> 0);
                            };
                            if (m3u8.m3u8Url.startsWith("data:")) {
                                m3u8.m3u8Url = `${cyrb53(m3u8.m3u8Url)}`;
                            }
                            if (this.m3u8DurationReCal[m3u8.m3u8Url] == undefined) {
                                this.m3u8DurationReCal[m3u8.m3u8Url] = calculateM3U8Duration(m3u8.m3u8Content);
                            }
                            m3u8.duration = this.m3u8DurationReCal[m3u8.m3u8Url];
                        } catch { }
                    })
                    this.m3u8Files[data['id']] = data['m3u8Files'];
                    this.m3u8PostWindows[data['id']] = _msg.source;
                    break;
                }
                case MessageType.FetchRealUrlReq: {
                    console.log(data);
                    if (realUrlCache[data.url] == undefined) {
                        const controller = new AbortController();
                        let r = await Fetch(data.url, {
                            method: "GET",
                            signal: controller.signal
                        });
                        controller.abort();
                        realUrlCache[data.url] = r.url;
                    }
                    sendMessageToTop(MessageType.FetchRealUrlResp, { origin: data.origin, real: realUrlCache[data.url] });
                    break;
                }
                case MessageType.FetchRealUrlResp: {
                    console.log(data);
                    WS.urlResp(data.origin, data.real);
                    break;
                }
                case MessageType.FetchRealUrlFromIframeReq: {
                    let real = await extension.FetchRemoteRealUrl(data.m3u8Url, data.idx, data.origin);
                    sendMessageTo(_msg.source, MessageType.FetchRealUrlFromIframeResp, { origin: data.origin, real: real });
                    break;
                }
                case MessageType.FetchRealUrlFromIframeResp: {
                    realUrlCache[data.origin] = data.real;
                    break;
                }
                case MessageType.SendTxtMsg: {
                    WS.sendTextMessage(data.currentSendingMsgId, data.value);
                    break;
                }
                case MessageType.GotTxtMsg: {
                    try {
                        GotTxtMsgCallback(data.id, data.msg);
                    } catch { };
                    this.sendMessageToSonWithContext(MessageType.GotTxtMsg, data);
                    break;
                }
                case MessageType.ReadIndexedDbSw: {
                    const result = await readFromIndexedDB(data.table, data.key);
                    data.data = result
                    navigator.serviceWorker.controller.postMessage({
                        source: "VideoTogether",
                        type: 2012,
                        data: data
                    });
                    break;
                }
                case MessageType.StartDownload: {
                    startDownload(data.m3u8Url, data.m3u8Content, data.urls, data.title, data.pageUrl);
                    setInterval(() => {
                        sendMessageToTop(MessageType.DownloadStatus, {
                            downloadSpeedMb: this.downloadSpeedMb,
                            downloadPercentage: this.downloadPercentage
                        })
                    }, 1000)
                    break;
                }
                case MessageType.DownloadStatus: {
                    extension.downloadSpeedMb = data.downloadSpeedMb;
                    extension.downloadPercentage = data.downloadPercentage;
                    if (extension.downloadPercentage == 100) {
                        if (this.downloadM3u8Completed != true) {
                            this.downloadM3u8Completed = true;
                            extension.Fetch(extension.video_together_host + "/beta/counter?key=download_m3u8_completed")
                        }
                        hide(select("#downloadingAlert"))
                        show(select("#downloadCompleted"))
                    }
                    select("#downloadStatus").innerText = extension.downloadPercentage + "% "
                    select("#downloadSpeed").innerText = extension.downloadSpeedMb.toFixed(2) + "MB/s"
                    select("#downloadProgressBar").value = extension.downloadPercentage
                    break;
                }
                default:
                    // console.info("unhandled message:", type, data)
                    break;
            }
        }

        openAllLinksInSelf() {
            let hrefs = document.getElementsByTagName("a");
            for (let i = 0; i < hrefs.length; i++) {
                hrefs[i].target = "_self";
            }
        }

        async RunWithRetry(func, count) {
            for (let i = 0; i < count; i++) {
                try {
                    return await func();
                } catch (e) { };
            }
        }

        setActivatedVideoDom(videoDom) {
            if (videoDom.VideoTogetherVideoId == undefined) {
                videoDom.VideoTogetherVideoId = generateUUID();
            }
            sendMessageToTop(MessageType.ActivatedVideo, new VideoModel(videoDom.VideoTogetherVideoId, videoDom.duration, Date.now() / 1000, Date.now() / 1000));
        }

        addListenerMulti(el, s, fn) {
            s.split(' ').forEach(e => el.addEventListener(e, fn, false));
        }

        VideoClicked(e) {
            console.info("vide event: ", e.type);
            // maybe we need to check if the event is activated by user interaction
            this.setActivatedVideoDom(e.target);
            if (!isLimited()) {
                sendMessageToTop(MessageType.CallScheduledTask, {});
            }
        }

        AddVideoListener(videoDom) {
            if (this.VideoClickedListener == undefined) {
                this.VideoClickedListener = this.VideoClicked.bind(this)
            }
            this.addListenerMulti(videoDom, "play pause seeked", this.VideoClickedListener);
        }

        CreateVideoDomObserver() {
            let _this = this;
            let observer = new WebKitMutationObserver(function (mutations) {
                mutations.forEach(function (mutation) {
                    for (let i = 0; i < mutation.addedNodes.length; i++) {
                        if (mutation.addedNodes[i].tagName == "VIDEO" || mutation.addedNodes[i].tagName == "BWP-VIDEO") {
                            try {
                                _this.AddVideoListener(mutation.addedNodes[i]);
                            } catch { }
                        }
                        try {
                            let videos = mutation.addedNodes[i].querySelectorAll("video");
                            [...videos].forEach(v => _this.AddVideoListener(v));
                        } catch { }
                        try {
                            if (extension.isMain && window.VideoTogetherStorage.OpenAllLinksInSelf != false && _this.role != _this.RoleEnum.Null) {
                                if (mutation.addedNodes[i].tagName == "A") {
                                    mutation.addedNodes[i].target = "_self";
                                }
                                let links = mutation.addedNodes[i].getElementsByTagName("a");
                                for (let i = 0; i < links.length; i++) {
                                    links[i].target = "_self";
                                }
                            }
                        } catch { }
                    }
                });
            });
            observer.observe(document.body || document.documentElement, { childList: true, subtree: true })
            this.video_tag_names.forEach(vTag => {
                let videos = document.getElementsByTagName(vTag);
                for (let i = 0; i < videos.length; i++) {
                    this.AddVideoListener(videos[i]);
                }
            })
        }

        getLocalTimestamp() {
            return Date.now() / 1000 + this.timeOffset;
        }

        async SyncTimeWithServer(url = null) {
            if (url == null) {
                url = this.video_together_host;
            }
            let startTime = Date.now() / 1000;
            let response = await this.Fetch(url + "/timestamp");
            let endTime = Date.now() / 1000;
            let data = await this.CheckResponse(response);
            this.httpSucc = true
            this.video_together_host = url;
            this.UpdateTimestampIfneeded(data["timestamp"], startTime, endTime);
            sendMessageToTop(MessageType.SetStorageValue, { key: "PublicVtVersion", value: data["vtVersion"] });
        }

        RecoveryState() {
            function RecoveryStateFrom(getFunc) {
                let vtRole = getFunc("VideoTogetherRole");
                let vtUrl = getFunc("VideoTogetherUrl");
                let vtRoomName = getFunc("VideoTogetherRoomName");
                let timestamp = parseFloat(getFunc("VideoTogetherTimestamp"));
                let password = getFunc("VideoTogetherPassword");
                let voice = getFunc("VideoTogetherVoice");
                if (timestamp + 60 < Date.now() / 1000) {
                    return;
                }

                if (vtUrl != null && vtRoomName != null) {
                    if (vtRole == this.RoleEnum.Member || vtRole == this.RoleEnum.Master) {
                        this.setRole(parseInt(vtRole));
                        this.url = vtUrl;
                        this.roomName = vtRoomName;
                        this.password = password;
                        window.videoTogetherFlyPannel.inputRoomName.value = vtRoomName;
                        window.videoTogetherFlyPannel.inputRoomPassword.value = password;
                        window.videoTogetherFlyPannel.InRoom();
                        switch (voice) {
                            case VoiceStatus.MUTED:
                                Voice.join("", vtRoomName, true);
                                break;
                            case VoiceStatus.UNMUTED:
                                Voice.join("", vtRoomName, false);
                                break;
                            default:
                                Voice.status = VoiceStatus.STOP;
                                break;
                        }
                    }
                }
            }

            let url = new URL(window.location);
            if (window.VideoTogetherStorage != undefined && window.VideoTogetherStorage.VideoTogetherTabStorageEnabled) {
                try {
                    RecoveryStateFrom.bind(this)(key => window.VideoTogetherStorage.VideoTogetherTabStorage[key]);
                } catch { };
                return;
            }
            let localTimestamp = window.sessionStorage.getItem("VideoTogetherTimestamp");
            let urlTimestamp = url.searchParams.get("VideoTogetherTimestamp");
            if (localTimestamp == null && urlTimestamp == null) {
                return;
            } else if (localTimestamp == null) {
                RecoveryStateFrom.bind(this)(key => url.searchParams.get(key));
            } else if (urlTimestamp == null) {
                RecoveryStateFrom.bind(this)(key => window.sessionStorage.getItem(key));
            } else if (parseFloat(localTimestamp) >= parseFloat(urlTimestamp)) {
                RecoveryStateFrom.bind(this)(key => window.sessionStorage.getItem(key));
            } else {
                RecoveryStateFrom.bind(this)(key => url.searchParams.get(key));
            }
        }

        async JoinRoom(name, password) {
            if (name == "") {
                popupError("Please input room name")
                return;
            }
            try {
                this.tempUser = generateTempUserId();
                this.roomName = name;
                this.password = password;
                this.setRole(this.RoleEnum.Member);
                window.videoTogetherFlyPannel.InRoom();
            } catch (e) {
                this.UpdateStatusText(e, "red");
            }
        }

        exitRoom() {
            this.voiceVolume = null;
            this.videoVolume = null;
            roomUuid = null;
            WS.disconnect();
            Voice.stop();
            show(select('#mainPannel'));
            hide(select('#voicePannel'));
            this.duration = undefined;
            window.videoTogetherFlyPannel.inputRoomName.value = "";
            window.videoTogetherFlyPannel.inputRoomPassword.value = "";
            this.roomName = "";
            this.setRole(this.RoleEnum.Null);
            window.videoTogetherFlyPannel.InLobby();
            let state = this.GetRoomState("");
            sendMessageToTop(MessageType.SetTabStorage, state);
            this.SaveStateToSessionStorageWhenSameOrigin("");
        }

        getVoiceVolume() {
            if (this.voiceVolume != null) {
                return this.voiceVolume;
            }
            try {
                if (window.VideoTogetherStorage.VideoTogetherTabStorage.VoiceVolume != null) {
                    return window.VideoTogetherStorage.VideoTogetherTabStorage.VoiceVolume;
                }
            } catch { }
            return 100;
        }

        getVideoVolume() {
            if (this.videoVolume != null) {
                return this.videoVolume;
            }
            try {
                if (window.VideoTogetherStorage.VideoTogetherTabStorage.VideoVolume != null) {
                    return window.VideoTogetherStorage.VideoTogetherTabStorage.VideoVolume;
                }
            } catch { }
            return 100;
        }

        async ScheduledTask(scheduled = false) {
            if (scheduled && this.lastScheduledTaskTs + 2 > Date.now() / 1000) {
                return;
            }
            this.lastScheduledTaskTs = Date.now() / 1000;

            try {
                if (this.isMain) {
                    if (windowPannel.videoVolume.value != this.getVideoVolume()) {
                        windowPannel.videoVolume.value = this.getVideoVolume()
                        windowPannel.videoVolume.dispatchEvent(new Event('input', { bubbles: true }));
                    }
                    if (windowPannel.callVolumeSlider.value != this.getVoiceVolume()) {
                        windowPannel.callVolumeSlider.value = this.getVoiceVolume();
                        windowPannel.callVolumeSlider.dispatchEvent(new Event('input', { bubbles: true }));
                    }

                    if (this.videoVolume != null) {
                        sendMessageToTop(MessageType.ChangeVideoVolume, { volume: this.getVideoVolume() / 100 });
                    }
                    [...select('#peer').querySelectorAll("*")].forEach(e => {
                        e.volume = this.getVoiceVolume() / 100;
                    });
                }
            } catch { }
            try {
                await this.ForEachVideo(video => {
                    if (video.VideoTogetherVideoId == undefined) {
                        video.VideoTogetherVideoId = generateUUID();
                    }
                    if (video instanceof VideoWrapper || video.VideoTogetherChoosed == true) {
                        // ad hoc
                        sendMessageToTop(MessageType.ReportVideo, new VideoModel(video.VideoTogetherVideoId, video.duration, 0, Date.now() / 1000, 1));
                    } else {
                        sendMessageToTop(MessageType.ReportVideo, new VideoModel(video.VideoTogetherVideoId, video.duration, 0, Date.now() / 1000));
                    }
                })
                this.videoMap.forEach((video, id, map) => {
                    if (video.refreshTime + VIDEO_EXPIRED_SECOND < Date.now() / 1000) {
                        map.delete(id);
                    }
                })
            } catch { };


            if (this.role != this.RoleEnum.Null) {
                if (this.isIos == null) {
                    this.isIos = await isAudioVolumeRO();
                }
                WS.connect();
                this.ctxWsIsOpen = WS.isOpen();
                if (!getEnableTextMessage()) {
                    windowPannel.setTxtMsgInterface(4);
                } else if (this.ctxWsIsOpen) {
                    windowPannel.setTxtMsgInterface(1);
                } else {
                    windowPannel.setTxtMsgInterface(2);
                }
                try {
                    if (this.isMain && window.VideoTogetherStorage.OpenAllLinksInSelf != false && !this.allLinksTargetModified) {
                        this.allLinksTargetModified = true;
                        this.openAllLinksInSelf();
                    }
                } catch { }
                try {
                    if (this.minTrip == 1e9 || !this.httpSucc) {
                        this.SyncTimeWithServer(this.video_together_main_host);
                        setTimeout(() => {
                            if (this.minTrip == 1e9 || !this.httpSucc) {
                                getApiHostChina().then(host => {
                                    this.SyncTimeWithServer(host);
                                });
                            }
                        }, 3000);
                    } else {
                        // TODO
                        // if (this.video_together_host == this.video_together_backup_host) {
                        //     this.SyncTimeWithServer(this.video_together_main_host);
                        // }
                    }
                } catch { };
            }

            try {
                switch (this.role) {
                    case this.RoleEnum.Null:
                        return;
                    case this.RoleEnum.Master: {
                        if (window.VideoTogetherStorage != undefined && window.VideoTogetherStorage.VideoTogetherTabStorageEnabled) {
                            let state = this.GetRoomState("");
                            sendMessageToTop(MessageType.SetTabStorage, state);
                        }
                        this.SaveStateToSessionStorageWhenSameOrigin("");
                        let video = this.GetVideoDom();
                        if (video == undefined) {
                            await this.UpdateRoom(this.roomName,
                                this.password,
                                this.linkWithoutState(window.location),
                                1,
                                0,
                                true,
                                1e9,
                                this.getLocalTimestamp());
                            throw new Error("No video in this page");
                        } else {
                            sendMessageToTop(MessageType.SyncMasterVideo, {
                                waitForLoadding: this.waitForLoadding,
                                video: video,
                                password: this.password,
                                roomName: this.roomName,
                                link: this.linkWithoutState(window.location)
                            });
                        }
                        break;
                    }
                    case this.RoleEnum.Member: {
                        let room = await this.GetRoom(this.roomName, this.password);
                        sendMessageToTop(MessageType.RoomDataNotification, room);
                        this.duration = room["duration"];
                        let newUrl = room["url"];
                        if (isEasyShareMember()) {
                            if (isEmpty(room['m3u8Url'])) {
                                throw new Error("Can't sync this video");
                            } else {
                                let _url = new URL(window.location);
                                _url.hash = room['m3u8Url'];
                                newUrl = _url.href;
                                window.VideoTogetherEasyShareUrl = room['url'];
                                window.VideoTogetherEasyShareTitle = room['videoTitle'];
                            }
                        }
                        if (newUrl != this.url && (window.VideoTogetherStorage == undefined || !window.VideoTogetherStorage.DisableRedirectJoin)) {
                            if (window.VideoTogetherStorage != undefined && window.VideoTogetherStorage.VideoTogetherTabStorageEnabled) {
                                let state = this.GetRoomState(newUrl);
                                sendMessageToTop(MessageType.SetTabStorage, state);
                                setInterval(() => {
                                    if (window.VideoTogetherStorage.VideoTogetherTabStorage.VideoTogetherUrl == newUrl) {
                                        try {
                                            if (isWeb()) {
                                                if (!this._jumping && window.location.origin != (new URL(newUrl).origin)) {
                                                    this._jumping = true;
                                                    alert("Please join again after jump");
                                                }
                                            }
                                        } catch { };
                                        this.SetTabStorageSuccessCallback = () => {
                                            sendMessageToTop(MessageType.JumpToNewPage, { url: newUrl });
                                            this.SetTabStorageSuccessCallback = () => { };
                                        }
                                    }
                                }, 200);
                            } else {
                                if (this.SaveStateToSessionStorageWhenSameOrigin(newUrl)) {
                                    sendMessageToTop(MessageType.JumpToNewPage, { url: newUrl });
                                } else {
                                    sendMessageToTop(MessageType.JumpToNewPage, { url: this.linkWithMemberState(newUrl).toString() });
                                }
                            }
                        } else {
                            let state = this.GetRoomState("");
                            sendMessageToTop(MessageType.SetTabStorage, state);
                        }
                        if (this.PlayAdNow()) {
                            throw new Error("Playing AD");
                        }
                        let video = this.GetVideoDom();
                        if (video == undefined) {
                            throw new Error("No video in this page");
                        } else {
                            sendMessageToTop(MessageType.SyncMemberVideo, { video: this.GetVideoDom(), roomName: this.roomName, password: this.password, room: room })
                        }
                        break;
                    }
                }
            } catch (e) {
                this.UpdateStatusText(e, "red");
            }
        }

        PlayAdNow() {
            try {
                // iqiyi
                if (window.location.hostname.endsWith('iqiyi.com')) {
                    let cdTimes = document.querySelectorAll('.cd-time');
                    for (let i = 0; i < cdTimes.length; i++) {
                        if (cdTimes[i].offsetParent != null) {
                            return true;
                        }
                    }
                }
            } catch { }
            try {
                if (window.location.hostname.endsWith('v.qq.com')) {
                    let adCtrls = document.querySelectorAll('.txp_ad_control:not(.txp_none)');
                    for (let i = 0; i < adCtrls.length; i++) {
                        if (adCtrls[i].getAttribute('data-role') == 'creative-player-video-ad-control') {
                            return true;
                        }
                    }
                }
            } catch { }
            try {
                if (window.location.hostname.endsWith('youku.com')) {
                    if (document.querySelector('.advertise-layer').querySelector('div')) {
                        return true;
                    }
                }
            } catch { }
            return false;
        }

        GetVideoDom() {
            let highPriorityVideo = undefined;
            this.videoMap.forEach(video => {
                if (video.priority > 0) {
                    highPriorityVideo = video;
                }
            })
            if (highPriorityVideo != undefined) {
                return highPriorityVideo;
            }
            if (this.role == this.RoleEnum.Master &&
                this.activatedVideo != undefined &&
                this.videoMap.get(this.activatedVideo.id) != undefined &&
                this.videoMap.get(this.activatedVideo.id).refreshTime + VIDEO_EXPIRED_SECOND >= Date.now() / 1000) {
                // do we need use this rule for member role? when multi closest videos?
                // return this.activatedVideo;
            }

            // get the longest video for master
            const _duration = this.duration == undefined ? 1e9 : this.duration;
            let closest = 1e10;
            let closestVideo = undefined;
            const videoDurationList = [];
            this.videoMap.forEach((video, id) => {
                try {
                    if (!isFinite(video.duration)) {
                        return;
                    }
                    videoDurationList.push(video.duration);
                    if (closestVideo == undefined) {
                        closestVideo = video;
                    }
                    if (Math.abs(video.duration - _duration) < closest) {
                        closest = Math.abs(video.duration - _duration);
                        closestVideo = video;
                    }
                } catch (e) { console.error(e); }
            });
            // collect this for debug
            this.videoDurationList = videoDurationList;
            return closestVideo;
        }

        async SyncMasterVideo(data, videoDom) {
            try {
                if (this.isMain) {
                    useMobileStyle(videoDom);
                }
            } catch { }

            if (skipIntroLen() > 0 && videoDom.currentTime < skipIntroLen()) {
                videoDom.currentTime = skipIntroLen();
            }
            if (data.waitForLoadding) {
                if (!videoDom.paused) {
                    videoDom.pause();
                    this.playAfterLoadding = true;
                }
            } else {
                if (this.playAfterLoadding) {
                    videoDom.play();
                }
                this.playAfterLoadding = false;
            }
            let paused = videoDom.paused;
            if (this.playAfterLoadding) {
                // some sites do not load video when paused
                paused = false;
            } else {
                if (!isVideoLoadded(videoDom)) {
                    paused = true;
                }
            }
            let m3u8Url;
            let m3u8UrlType;
            try {
                let nativeSrc = videoDom.src;
                if (nativeSrc == "" || nativeSrc == undefined) {
                    nativeSrc = videoDom.querySelector('source').src;
                }

                nativeSrc = new URL(nativeSrc, window.location).href
                if (nativeSrc.startsWith('http')) {
                    m3u8Url = nativeSrc;
                }

                this.testM3u8OrVideoUrl(nativeSrc).then(r => {
                    if (r == 'm3u8' && this.hasCheckedM3u8Url[nativeSrc] != true) {
                        fetch(nativeSrc).then(r => r.text()).then(m3u8Content => {
                            if (isMasterM3u8(m3u8Content)) {
                                const mediaM3u8Url = getFirstMediaM3U8(m3u8Content, nativeSrc);
                                fetch(mediaM3u8Url).then(r => r.text()).then(() => {
                                    this.hasCheckedM3u8Url[nativeSrc] = true;
                                })
                            } else {
                                this.hasCheckedM3u8Url[nativeSrc] = true;
                            }
                        }
                        )
                    }
                })
                m3u8UrlType = this.m3u8UrlTestResult[nativeSrc]

            } catch { };
            sendMessageToTop(MessageType.UpdateRoomRequest, {
                name: data.roomName,
                password: data.password,
                url: data.link,
                playbackRate: videoDom.playbackRate,
                currentTime: videoDom.currentTime,
                paused: paused,
                duration: videoDom.duration,
                localTimestamp: this.getLocalTimestamp(),
                m3u8Url: m3u8Url,
                m3u8UrlType: m3u8UrlType
            })
        }

        linkWithoutState(link) {
            let url = new URL(link);
            url.searchParams.delete("VideoTogetherUrl");
            url.searchParams.delete("VideoTogetherRoomName");
            url.searchParams.delete("VideoTogetherRole");
            url.searchParams.delete("VideoTogetherPassword");
            url.searchParams.delete("VideoTogetherTimestamp");
            return url.toString();
        }

        GetRoomState(link) {
            if (inDownload) {
                return {};
            }
            if (this.role == this.RoleEnum.Null) {
                return {};
            }

            let voice = Voice.status;
            if (voice == VoiceStatus.CONNECTTING) {
                try {
                    voice = window.VideoTogetherStorage.VideoTogetherTabStorage.VideoTogetherVoice;
                } catch {
                    voice = VoiceStatus.STOP;
                }
            }

            return {
                VideoTogetherUrl: link,
                VideoTogetherRoomName: this.roomName,
                VideoTogetherPassword: this.password,
                VideoTogetherRole: this.role,
                VideoTogetherTimestamp: Date.now() / 1000,
                VideoTogetherVoice: voice,
                VideoVolume: this.getVideoVolume(),
                VoiceVolume: this.getVoiceVolume()
            }
        }

        SaveStateToSessionStorageWhenSameOrigin(link) {
            if (inDownload) {
                return false;
            }
            try {
                let sameOrigin = false;
                if (link != "") {
                    let url = new URL(link);
                    let currentUrl = new URL(window.location);
                    sameOrigin = (url.origin == currentUrl.origin);
                }

                if (link == "" || sameOrigin) {
                    window.sessionStorage.setItem("VideoTogetherUrl", link);
                    window.sessionStorage.setItem("VideoTogetherRoomName", this.roomName);
                    window.sessionStorage.setItem("VideoTogetherPassword", this.password);
                    window.sessionStorage.setItem("VideoTogetherRole", this.role);
                    window.sessionStorage.setItem("VideoTogetherTimestamp", Date.now() / 1000);
                    return sameOrigin;
                } else {
                    return false;
                }
            } catch (e) { console.error(e); }
        }

        linkWithMemberState(link, newRole = undefined, expire = true) {
            let url = new URL(link);
            let tmpSearch = url.search;
            url.search = "";
            url.searchParams.set("VideoTogetherUrl", link);
            url.searchParams.set("VideoTogetherRoomName", this.roomName);
            url.searchParams.set("VideoTogetherPassword", this.password);
            url.searchParams.set("VideoTogetherRole", newRole ? newRole : this.role);
            url.searchParams.set("VideoTogetherTimestamp", expire ? Date.now() / 1000 : 1e10);
            let urlStr = url.toString();
            if (tmpSearch.length > 1) {
                urlStr = urlStr + "&" + tmpSearch.slice(1);
            }
            return new URL(urlStr);
        }

        CalculateRealCurrent(data) {
            let playbackRate = parseFloat(data["playbackRate"]);
            return data["currentTime"] + (this.getLocalTimestamp() - data["lastUpdateClientTime"]) * (isNaN(playbackRate) ? 1 : playbackRate);
        }

        GetDisplayTimeText() {
            let date = new Date();
            return date.getHours() + ":" + date.getMinutes() + ":" + date.getSeconds();
        }

        async SyncMemberVideo(data, videoDom) {
            try {
                if (this.isMain) {
                    useMobileStyle(videoDom);
                }
            } catch { }
            if (this.lastSyncMemberVideo + 1 > Date.now() / 1000) {
                return;
            }
            this.lastSyncMemberVideo = Date.now() / 1000;

            let room = data.room;
            sendMessageToTop(MessageType.GetRoomData, room);

            // useless
            this.duration = room["duration"];
            // useless
            if (videoDom == undefined) {
                throw new Error("没有视频");
            }

            const waitForLoadding = room['waitForLoadding'];
            let paused = room['paused'];
            if (waitForLoadding && !paused && !Var.isThisMemberLoading) {
                paused = true;
            }
            let isLoading = (Math.abs(this.memberLastSeek - videoDom.currentTime) < 0.01);
            this.memberLastSeek = -1;
            if (paused == false) {
                videoDom.videoTogetherPaused = false;
                if (Math.abs(videoDom.currentTime - this.CalculateRealCurrent(room)) > 1) {
                    videoDom.currentTime = this.CalculateRealCurrent(room);
                }
                // play fail will return so here is safe
                this.memberLastSeek = videoDom.currentTime;
            } else {
                videoDom.videoTogetherPaused = true;
                if (Math.abs(videoDom.currentTime - room["currentTime"]) > 0.1) {
                    videoDom.currentTime = room["currentTime"];
                }
            }
            if (videoDom.paused != paused) {
                if (paused) {
                    console.info("pause");
                    videoDom.pause();
                } else {
                    try {
                        console.info("play");
                        {
                            // check if the video is ready
                            if (window.location.hostname.endsWith('aliyundrive.com')) {
                                if (videoDom.readyState == 0) {
                                    throw new Error("Need to play manually");
                                }
                            }
                        }
                        await videoDom.play();
                        if (videoDom.paused) {
                            throw new Error("Need to play manually");
                        }
                    } catch (e) {
                        throw new Error("Need to play manually");
                    }
                }
            }
            if (videoDom.playbackRate != room["playbackRate"]) {
                try {
                    videoDom.playbackRate = parseFloat(room["playbackRate"]);
                } catch (e) { }
            }
            if (isNaN(videoDom.duration)) {
                throw new Error("Need to play manually");
            }
            sendMessageToTop(MessageType.UpdateStatusText, { text: "Sync " + this.GetDisplayTimeText(), color: "green" });

            setTimeout(() => {
                try {
                    if (Math.abs(room["duration"] - videoDom.duration) < 0.5) {
                        isLoading = isLoading && !isVideoLoadded(videoDom)
                    } else {
                        isLoading = false;
                    }
                } catch { isLoading = false };
                Var.isThisMemberLoading = isLoading;
                // make the member count update slow
                sendMessageToTop(MessageType.UpdateMemberStatus, { isLoadding: isLoading });
            }, 1);
        }

        async CheckResponse(response) {
            if (response.status != 200) {
                throw new Error("http code: " + response.status);
            } else {
                let data = await response.json();
                if ("errorMessage" in data) {
                    throw new Error(data["errorMessage"]);
                }
                return data;
            }
        }

        async CreateRoom(name, password) {
            if (name == "") {
                popupError("Please input room name")
                return;
            }
            try {
                this.tempUser = generateTempUserId();
                let url = this.linkWithoutState(window.location);
                let data = this.RunWithRetry(async () => await this.UpdateRoom(name, password, url, 1, 0, true, 0, this.getLocalTimestamp()), 2);
                this.setRole(this.RoleEnum.Master);
                this.roomName = name;
                this.password = password;
                window.videoTogetherFlyPannel.InRoom();
            } catch (e) { this.UpdateStatusText(e, "red") }
        }

        setWaitForLoadding(b) {
            let enabled = true;
            try { enabled = (window.VideoTogetherStorage.WaitForLoadding != false) } catch { }
            this.waitForLoadding = enabled && b;
        }

        async UpdateRoom(name, password, url, playbackRate, currentTime, paused, duration, localTimestamp, m3u8Url = "") {
            m3u8Url = emptyStrIfUdf(m3u8Url);
            try {
                if (window.location.pathname == "/page") {
                    let url = new URL(atob(new URL(window.location).searchParams.get("url")));
                    window.location = url;
                }
            } catch { }
            WS.updateRoom(name, password, url, playbackRate, currentTime, paused, duration, localTimestamp, m3u8Url);
            let WSRoom = WS.getRoom();
            if (WSRoom != null) {
                this.setWaitForLoadding(WSRoom['waitForLoadding']);
                sendMessageToTop(MessageType.RoomDataNotification, WSRoom);
                return WSRoom;
            }
            let apiUrl = new URL(this.video_together_host + "/room/update");
            apiUrl.searchParams.set("name", name);
            apiUrl.searchParams.set("password", password);
            apiUrl.searchParams.set("playbackRate", playbackRate);
            apiUrl.searchParams.set("currentTime", currentTime);
            apiUrl.searchParams.set("paused", paused);
            apiUrl.searchParams.set("url", url);
            apiUrl.searchParams.set("lastUpdateClientTime", localTimestamp);
            apiUrl.searchParams.set("duration", duration);
            apiUrl.searchParams.set("tempUser", this.tempUser);
            apiUrl.searchParams.set("protected", isRoomProtected());
            apiUrl.searchParams.set("videoTitle", this.isMain ? document.title : this.videoTitle);
            apiUrl.searchParams.set("m3u8Url", emptyStrIfUdf(m3u8Url));
            let startTime = Date.now() / 1000;
            let response = await this.Fetch(apiUrl);
            let endTime = Date.now() / 1000;
            let data = await this.CheckResponse(response);
            sendMessageToTop(MessageType.RoomDataNotification, data);
            this.UpdateTimestampIfneeded(data["timestamp"], startTime, endTime);
            return data;
        }

        async UpdateTimestampIfneeded(serverTimestamp, startTime, endTime) {
            if (typeof serverTimestamp == 'number' && typeof startTime == 'number' && typeof endTime == 'number') {
                if (endTime - startTime < this.minTrip) {
                    this.timeOffset = serverTimestamp - (startTime + endTime) / 2;
                    this.minTrip = endTime - startTime;
                }
            }
        }

        async GetRoom(name, password) {
            WS.joinRoom(name, password);
            let WSRoom = WS.getRoom();
            if (WSRoom != null) {
                // TODO updatetimestamp
                return WSRoom;
            }
            let url = new URL(this.video_together_host + "/room/get");
            url.searchParams.set("name", name);
            url.searchParams.set("tempUser", this.tempUser);
            url.searchParams.set("password", password);
            let startTime = Date.now() / 1000;
            let response = await this.Fetch(url);
            let endTime = Date.now() / 1000;
            let data = await this.CheckResponse(response);
            this.UpdateTimestampIfneeded(data["timestamp"], startTime, endTime);
            return data;
        }

        EnableDraggable() {
            if (!window.videoTogetherFlyPannel) return;

            function filter(e) {
                let target = undefined;
                if (window.videoTogetherFlyPannel.videoTogetherHeader.contains(e.target)) {
                    target = window.videoTogetherFlyPannel.videoTogetherFlyPannel;
                } else {
                    return;
                }


                target.videoTogetherMoving = true;

                if (e.clientX) {
                    target.oldX = e.clientX;
                    target.oldY = e.clientY;
                } else {
                    target.oldX = e.touches[0].clientX;
                    target.oldY = e.touches[0].clientY;
                }

                target.oldLeft = window.getComputedStyle(target).getPropertyValue('left').split('px')[0] * 1;
                target.oldTop = window.getComputedStyle(target).getPropertyValue('top').split('px')[0] * 1;

                document.onmousemove = dr;
                document.ontouchmove = dr;
                document.onpointermove = dr;

                function dr(event) {

                    if (!target.videoTogetherMoving) {
                        return;
                    }
                    event.preventDefault();
                    event.stopPropagation();
                    if (event.clientX) {
                        target.distX = event.clientX - target.oldX;
                        target.distY = event.clientY - target.oldY;
                    } else {
                        target.distX = event.touches[0].clientX - target.oldX;
                        target.distY = event.touches[0].clientY - target.oldY;
                    }

                    target.style.left = Math.min(document.documentElement.clientWidth - target.clientWidth, Math.max(0, target.oldLeft + target.distX)) + "px";
                    target.style.top = Math.min(document.documentElement.clientHeight - target.clientHeight, Math.max(0, target.oldTop + target.distY)) + "px";

                    window.addEventListener('resize', function (event) {
                        target.oldLeft = window.getComputedStyle(target).getPropertyValue('left').split('px')[0] * 1;
                        target.oldTop = window.getComputedStyle(target).getPropertyValue('top').split('px')[0] * 1;
                        target.style.left = Math.min(document.documentElement.clientWidth - target.clientWidth, Math.max(0, target.oldLeft)) + "px";
                        target.style.top = Math.min(document.documentElement.clientHeight - target.clientHeight, Math.max(0, target.oldTop)) + "px";
                    });
                }

                function endDrag() {
                    target.videoTogetherMoving = false;
                }
                target.onmouseup = endDrag;
                target.ontouchend = endDrag;
                target.onpointerup = endDrag;
            }
            window.videoTogetherFlyPannel.videoTogetherHeader.onmousedown = filter;
            window.videoTogetherFlyPannel.videoTogetherHeader.ontouchstart = filter;
            window.videoTogetherFlyPannel.videoTogetherHeader.onpointerdown = filter;
        }
    }

    try {
        if (window.location.hostname == 'yiyan.baidu.com' || window.location.hostname.endsWith('cloudflare.com')) {
            GetNativeFunction();
            window.Element.prototype.attachShadow = Global.NativeAttachShadow;
        }
    } catch { }

    // TODO merge Pannel and Extension class
    if (window.videoTogetherFlyPannel === undefined) {
        window.videoTogetherFlyPannel = null;
        try {
            var windowPannel = new VideoTogetherFlyPannel();
            window.videoTogetherFlyPannel = windowPannel;
        } catch (e) { console.error(e) }
    }
    if (window.videoTogetherExtension === undefined) {
        window.videoTogetherExtension = null;
        var extension = new VideoTogetherExtension();
        window.videoTogetherExtension = extension;
        sendMessageToSelf(MessageType.ExtensionInitSuccess, {})
    }
    try {
        document.querySelector("#videoTogetherLoading").remove()
    } catch { }
})()
