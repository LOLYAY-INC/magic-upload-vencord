/**
 * @name MagicUpload
 * @website https://github.com/mack/magic-upload
 * @source
 */
module.exports = (() => {
    // Node.js built-in modules
    const Http = require("http");
    const Https = require("https");
    const Url = require("url");
    const Crypto = require("crypto");
    const Fs = require("fs");

    // BetterDiscord API module references
    const FluxDispatcher = global.BdApi.findModuleByProps("dispatch", "subscribe");
    const CurrentUserStore = global.BdApi.findModuleByProps("getCurrentUser");
    const FileUploadValidation = global.BdApi.findModuleByProps("anyFileTooLarge", "maxFileSize");
    const FileUploadManager = global.BdApi.findModuleByProps("instantBatchUpload", "upload");
    const MessageSender = global.BdApi.findModuleByProps("sendMessage");
    const DiscordButton = global.BdApi.findModuleByProps("BorderColors"); // This is actually the Button component
    const SwitchItem = global.BdApi.findModuleByDisplayName("SwitchItem");
    const TextInput = global.BdApi.findModule(n => n.defaultProps && n.defaultProps.type === "text"); // Generic text input component
    const ModalsStore = global.BdApi.findModuleByProps("useModalsStore", "closeModal");
    const AttachmentUploadComponent = global.BdApi.findModule(n => n.AttachmentUpload).AttachmentUpload;
    const MessageContentClasses = { ...global.BdApi.findModule(n => n.avatar && n.messageContent && n.alt), ...global.BdApi.findModuleByProps("groupStart") };
    const ScrollerClasses = global.BdApi.findModuleByProps("scrollerSpacer");
    const FormDividerClasses = { ...global.BdApi.findModuleByProps("divider"), ...global.BdApi.findModuleByProps("dividerDefault") };

    // Plugin Configuration
    const Config = {
        meta: {
            version: "1.0.0",
            name: "MagicUpload",
            description: "\u{1F9D9}\u200D\u2640\uFE0F A BetterDiscord plugin to automagically upload files over 8MB.",
            authors: [{
                name: "mack",
                discord_id: "365247132375973889",
                github_username: "mack"
            }]
        },
        oauth: {
            handler: {
                port: 29842,
                host: "localhost"
            },
            clientId: "911268808772-r7sa3s88f2o36hdcu9g4tmih6dbo4n77.apps.googleusercontent.com",
            clientSecret: "GOCSPX-QYy9OYI8rUdTGbRZsbur7xPZb4t"
        },
        storage: {
            algorithm: "aes-256-ctr",
            secretKey: "jXn2r5u8x/A?D*G-KaPdSgVkYp3s6v9y", // Replace with a more robust secret management in production
            iv: Crypto.randomBytes(16), // Initialization Vector
            credentialsKey: "_magicupload_oa_creds_gd",
            uploadsKey: "_magicupload_files_inprogress",
            uploadHistoryKey: "_magicupload_files_completed",
            settingsKey: "_magicupload_settings",
            defaultSettings: {
                autoUpload: true,
                uploadEverything: false,
                embed: true, // Not used in current code, but might be for future features
                directLink: true,
                verbose: false
            }
        },
        upload: {
            chunkMultiplier: 10 // Multiplier for 256KB chunks (10 * 256KB = 2.56MB)
        }
    };

    // HTTP Status Codes
    const HTTP_OK = 200;
    const HTTP_PARTIAL_CONTENT = 308; // For resumable uploads
    const HTTP_UNAUTHORIZED = 401;
    const HTTP_NOT_FOUND = 404;
    const HTTP_INTERNAL_SERVER_ERROR = 500;

    // Google API Endpoints
    const GOOGLE_OAUTH_AUTH_URL = `https://accounts.google.com/o/oauth2/v2/auth?scope=https://www.googleapis.com/auth/drive&redirect_uri=http://${Config.oauth.handler.host}:${Config.oauth.handler.port}&response_type=code&client_id=${Config.oauth.clientId}`;
    const GOOGLE_OAUTH_TOKEN_URL = "https://oauth2.googleapis.com/token";
    const GOOGLE_OAUTH_REVOKE_URL = "https://oauth2.googleapis.com/revoke";
    const GOOGLE_DRIVE_UPLOAD_RESUMABLE_URL = "https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable";
    const GOOGLE_DRIVE_FILES_URL = "https://www.googleapis.com/drive/v3/files";

    // Google Drive Permission Roles/Types
    const GOOGLE_DRIVE_PERMISSION_ROLE_READER = "reader";
    const GOOGLE_DRIVE_PERMISSION_TYPE_ANYONE = "anyone";

    // Custom Error / Status messages
    const UPLOAD_CANCELLED_ERROR = "upload_cancelled";

    // HTML for success and error pages served by local OAuth handler
    const GoogleDriveConnectedPageHtml = () => `
<!DOCTYPE html>
<html>
    <head>
        <meta charset="UTF-8">
        <link rel="preconnect" href="https://fonts.googleapis.com">
        <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
        <link href="https://fonts.googleapis.com/css2?family=Roboto:wght@300;400;500&family=Staatliches&display=swap" rel="stylesheet">
        <title>Magic Upload - Google Drive Connected</title>
        <script src="https://kit.fontawesome.com/9fd6d0c095.js" crossorigin="anonymous"></script>
    </head>
    <body>
        <style>
            * {
                box-sizing: border-box;
            }
            body {
                max-width: 870px;
                margin: 0 auto;
            }
            .container {
                text-align: center;
                font-family: "Roboto", sans-serif;
                display: flex;
                justify-content: center;
                align-items: center;
                flex-direction: column;
                height: 90vh;
                position: relative;
                color: #363636;
                padding-left: 5rem;
                padding-right: 5rem;
            }
            .header img {
                width: 80px;
            }
            .header {
                display: flex;
                align-items: center;
                font-family: "Staatliches", cursive;
                font-size: 48px;
                margin-bottom: 0;
            }
            .header i {
                font-size: 18px;
                margin: 0 0.5rem;
            }
            p {
                padding: 0 2rem;
                margin-top: 0;
                font-size: 18px;
                line-height: 24px;
            }
            .footer {
                position: absolute;
                bottom: 1rem;
                font-size: 14px;
                opacity: 0.4;
            }
            .magic {
                color: #5e2de5;
                text-shadow: 0 8px 24px rgb(94 45 229 / 25%);
            }
            .tooltip {
                position: relative;
                display: inline-block;
                border-bottom: 1px dotted black;
            }
            .tooltip .tooltiptext {
                font-size: 16px;
                line-height: 20px;
                visibility: hidden;
                width: 120px;
                bottom: 130%;
                left: 50%;
                margin-left: -60px;
                background-color: rgba(0,0,0,0.9);
                color: #fff;
                text-align: center;
                padding: 5px 0;
                border-radius: 6px;
                opacity: 0;
                transition: .3s;
                position: absolute;
                z-index: 1;
            }
            .tooltip .tooltiptext::after {
                content: " ";
                position: absolute;
                top: 100%;
                left: 50%;
                margin-left: -5px;
                border-width: 5px;
                border-style: solid;
                border-color: #363636 transparent transparent transparent;
            }
            .tooltip:hover .tooltiptext {
                visibility: visible;
                opacity: 1;
            }
            a {
                color: #363636;
                transition: .3s;
            }
            a:hover{
                color: #5e2de5;
                text-shadow: 0 8px 24px rgb(94 45 229 / 25%);
            }
            hr {
                width: 50px;
                opacity: 0.5;
            }
        </style>
        <div class="container">
            <h1 class="header"><span class="magic">MagicUpload</span> <i class="fa-solid fa-link"></i> <img src="https://upload.wikimedia.org/wikipedia/commons/1/12/Google_Drive_icon_%282020%29.svg" /></h1>
            <hr>
            <p class="about">\u2705 You"ve successfully linked your Google Drive account! You can now upload files that exceed your discord limit and they"ll automatically uploaded to your drive.</p>
            <p class="help">Need any help? Checkout our <a href="https://github.com/mack/magic-upload" class="tooltip"> <i class="fa-brands fa-github"></i> <span class="tooltiptext">GitHub</span> </a> or <a href="" class="tooltip"> <i class="fa-brands fa-discord"></i> <span class="tooltiptext">Community Discord</span> </a> . </p>
            <span class="footer">© Mackenzie Boudreau</span>
        </div>
        <script src="https://unpkg.com/scrollreveal@4.0.0/dist/scrollreveal.min.js"></script>
        <script src="https://cdn.jsdelivr.net/npm/js-confetti@latest/dist/js-confetti.browser.js"></script>
        <script>
            const sr = ScrollReveal({ origin: "top", distance: "60px", duration: 2500, delay: 400, });
            sr.reveal(".header", {delay: 700});
            sr.reveal("hr", {delay: 500});
            sr.reveal(".about", {delay: 900, origin: "bottom"});
            sr.reveal(".help", {delay: 1000, origin: "bottom"});
            sr.reveal(".footer", {delay: 800, origin: "bottom"});
            const jsConfetti = new JSConfetti();
            setTimeout(() => {
                jsConfetti.addConfetti()
            }, 2000);
        </script>
    </body>
</html>`;

    const GoogleDriveErrorPageHtml = errorPayload => `
<!DOCTYPE html>
<html>
    <head>
        <meta charset="UTF-8">
        <link rel="preconnect" href="https://fonts.googleapis.com">
        <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
        <link href="https://fonts.googleapis.com/css2?family=Roboto+Mono:wght@300&family=Roboto:wght@300;400;500&family=Staatliches&display=swap" rel="stylesheet">
        <title>Magic Upload - Error</title>
        <script src="https://kit.fontawesome.com/9fd6d0c095.js" crossorigin="anonymous"></script>
    </head>
    <body>
        <style>
            * {
                box-sizing: border-box;
            }
            body {
                max-width: 870px;
                margin: 0 auto;
            }
            .container {
                text-align: center;
                font-family: "Roboto", sans-serif;
                display: flex;
                justify-content: center;
                align-items: center;
                flex-direction: column;
                height: 90vh;
                position: relative;
                color: #363636;
                padding-left: 5rem;
                padding-right: 5rem;
            }
            h1 {
                font-family: "Staatliches", cursive;
                font-size: 48px;
                margin-bottom: 0;
            }
            p {
                padding: 0 2rem;
                margin-top: 0;
                font-size: 18px;
                line-height: 24px;
            }
            .footer {
                position: absolute;
                bottom: 1rem;
                font-size: 14px;
                opacity: 0.4;
            }
            .error, .header > i {
                color: rgb(229, 45, 45);
                text-shadow: 0 8px 24px rgb(229 45 45 / 25%);
            }
            .tooltip {
                position: relative;
                display: inline-block;
                border-bottom: 1px dotted black;
            }
            .tooltip .tooltiptext {
                font-size: 16px;
                line-height: 20px;
                visibility: hidden;
                width: 120px;
                bottom: 130%;
                left: 50%;
                margin-left: -60px;
                background-color: rgba(0,0,0,0.9);
                color: #fff;
                text-align: center;
                padding: 5px 0;
                border-radius: 6px;
                opacity: 0;
                transition: .3s;
                position: absolute;
                z-index: 1;
            }
            .tooltip .tooltiptext::after {
                content: " ";
                position: absolute;
                top: 100%;
                left: 50%;
                margin-left: -5px;
                border-width: 5px;
                border-style: solid;
                border-color: #363636 transparent transparent transparent;
            }
            .tooltip:hover .tooltiptext {
                visibility: visible;
                opacity: 1;
            }
            a {
                color: #363636;
                transition: .3s;
            }
            a:hover{
                color: #5e2de5;
                text-shadow: 0 8px 24px rgb(94 45 229 / 25%);
            }
            hr {
                width: 50px;
                opacity: 0.5;
            }
            .error_container {
                max-width: 100%;
                position: relative;
            }
            .error_container:hover .error_label {
                opacity: 0.3;
            }
            .error_code {
                font-size: 14px;
                background-color: rgba(0,0,0,0.92);
                border-radius: 6px;
                padding-top: 2rem;
                padding-bottom: 2rem;
                padding-right: 2rem;
                padding-left: 2rem;
                color: white;
                text-align: left;
                word-wrap: break-word;
                font-family: 'Roboto Mono', monospace;
            }
            .error_label {
                transition: .3s;
                cursor: default;
                font-size: 12px;
                text-transform: uppercase;
                opacity: 0;
                color: white;
                position: absolute;
                right: 2rem;
                top: 1rem;
            }
        </style>
        <div class="container">
            <h1 class="header"><i class="fa-solid fa-triangle-exclamation"></i> Uh oh, something went <span class="error">wrong</span> <i class="fa-solid fa-triangle-exclamation"></i></h1>
            <hr>
            <p class="about">We weren't able to connect your Google Drive account with MagicUpload. Please try again or reach out to help in our community discord. </p>
            <p class="help">Need any help? Checkout our <a href="https://github.com/mack/magic-upload" class="tooltip"> <i class="fa-brands fa-github"></i> <span class="tooltiptext">GitHub</span> </a> or <a href="" class="tooltip"> <i class="fa-brands fa-discord"></i> <span class="tooltiptext">Community Discord</span> </a> . </p>
            <div class="error_container">
                <span class="error_label">OAuth Response // JSON</span>
                <div class="error_code">
                    ${errorPayload.error_message}
                </div>
            </div>
            <span class="footer">© Mackenzie Boudreau</span>
        </div>
        <script src="https://unpkg.com/scrollreveal@4.0.0/dist/scrollreveal.min.js"></script>
        <script src="https://cdn.jsdelivr.net/npm/js-confetti@latest/dist/js-confetti.browser.js"></script>
        <script>
            const sr = ScrollReveal({ origin: "top", distance: "60px", duration: 2500, delay: 400, });
            sr.reveal(".header", {delay: 700});
            sr.reveal("hr", {delay: 500});
            sr.reveal(".about", {delay: 900, origin: "bottom"});
            sr.reveal(".help", {delay: 1000, origin: "bottom"});
            sr.reveal(".error_code", {delay: 1000, origin: "bottom"});
            sr.reveal(".footer", {delay: 800, origin: "bottom"});
        </script>
    </body>
</html>`;

    // Utility functions for logging, UI, encryption, etc.
    const Utils = {
        log(...messages) {
            (global.BdApi.loadData(Config.meta.name, Config.storage.settingsKey) || {}).verbose && Utils.console(messages, "log");
        },
        info(message) {
            Utils.console(message, "info");
        },
        warn(message) {
            Utils.console(message, "warn");
        },
        error(message) {
            Utils.console(message, "error");
        },
        console(message, type) {
            const consoleTypes = {
                log: "log",
                info: "info",
                dbg: "debug",
                debug: "debug",
                warn: "warn",
                err: "error",
                error: "error"
            };
            const consoleMethod = Object.prototype.hasOwnProperty.call(consoleTypes, type) ? consoleTypes[type] : "log";
            const messageArray = Array.isArray(message) ? message : [message];
            console[consoleMethod](`%c[${Config.meta.name}]%c`, "color: #3a71c1; font-weight: 700;", "", ...messageArray);
        },
        showSuccessToast(message, options) {
            global.BdApi.showToast(message, { type: "success", ...options });
        },
        showInfoToast(message, options) {
            global.BdApi.showToast(message, { type: "info", ...options });
        },
        showWarnToast(message, options) {
            global.BdApi.showToast(message, { type: "warning", ...options });
        },
        showErrorToast(message, options) {
            global.BdApi.showToast(message, { type: "error", ...options });
        },
        addAuthHeaderToOptions(options, storageManager) {
            const accessToken = storageManager.getAccessToken();
            if (accessToken) {
                options.headers = { ...options.headers,
                    Authorization: `Bearer ${accessToken}`
                };
            }
            return options;
        },
        encrypt(text) {
            const { algorithm, secretKey, iv } = Config.storage;
            const cipher = Crypto.createCipheriv(algorithm, secretKey, iv);
            const encrypted = Buffer.concat([cipher.update(text), cipher.final()]);
            return {
                iv: iv.toString("hex"),
                content: encrypted.toString("hex")
            };
        },
        decrypt(hash) {
            const { algorithm, secretKey } = Config.storage;
            const decipher = Crypto.createDecipheriv(algorithm, secretKey, Buffer.from(hash.iv, "hex"));
            const decrypted = Buffer.concat([decipher.update(Buffer.from(hash.content, "hex")), decipher.final()]);
            return decrypted.toString();
        },
        override(module, methodName, callback, options) {
            const patch = global.BdApi.monkeyPatch(module, methodName, { ...options,
                instead: callback
            });
            window.magicUploadOverrides ? window.magicUploadOverrides.push(patch) : window.magicUploadOverrides = [patch];
        },
        clearOverrides() {
            if (Array.isArray(window.magicUploadOverrides)) {
                window.magicUploadOverrides.forEach(patch => patch());
                window.magicUploadOverrides = [];
            }
        },
        prettifySize(bytes) {
            const sizes = ["Bytes", "KB", "MB", "GB", "TB"];
            if (bytes === 0) return "0 Byte";
            const i = parseInt(Math.floor(Math.log(bytes) / Math.log(1024)), 10);
            return `${Math.round(bytes / (1024 ** i), 2)} ${sizes[i]}`;
        },
        prettifyType(mimeType) {
            const parts = mimeType.split("/");
            if (parts.length === 2) return parts[0];
            return mimeType; // Return original if not standard mime type
        },
        truncate(text, maxLength = 35) {
            return text.length > maxLength ? `${text.substr(0, maxLength - 1)}...` : text;
        },
        driveLink(fileId) {
            return `https://drive.google.com/file/d/${fileId}`;
        },
        directDriveLink(fileId) {
            return `https://drive.google.com/uc?export=download&id=${fileId}`;
        },
        discordAvatarLink(userId, avatarHash) {
            return `https://cdn.discordapp.com/avatars/${userId}/${avatarHash}.webp?size=160`;
        },
        convertFileToMagicFile(file, destinationChannelId, messageContent) {
            return {
                lastModified: file.lastModified,
                lastModifiedDate: file.lastModifiedDate,
                name: file.name,
                path: file.path,
                size: file.size,
                type: file.type,
                webkitRelativePath: file.webkitRelativePath,
                mu_destination: destinationChannelId,
                mu_content: messageContent // Message text accompanying the upload
            };
        },
        parseReceivedRange(rangeHeader) {
            const parts = rangeHeader.split("-");
            if (parts.length === 2) return parseInt(parts[1], 10);
            return 0; // Default to 0 if range is invalid
        },
        closeLastModal() {
            const lastModal = ModalsStore.useModalsStore.getState().default[0];
            if (lastModal) {
                ModalsStore.closeModal(lastModal.key);
            }
        }
    };

    // Base class for displaying a custom Discord message
    class BaseMessageDisplay {
        constructor(messageElement, channelId, timestamp, username, avatarUrl) {
            this.channelId = channelId;
            const listItem = document.createElement("li");
            const messageWrapper = document.createElement("div");
            const messageContainer = document.createElement("div");
            messageContainer.className = `${MessageContentClasses.cozy} ${MessageContentClasses.groupStart} ${MessageContentClasses.wrapper}`;

            const avatarImg = document.createElement("img");
            avatarImg.src = avatarUrl;
            avatarImg.className = MessageContentClasses.avatar;
            messageContainer.appendChild(avatarImg);

            const header = document.createElement("h2");
            const usernameSpan = document.createElement("span");
            usernameSpan.innerHTML = username;
            usernameSpan.className = `${MessageContentClasses.headerText} ${MessageContentClasses.username}`;
            header.appendChild(usernameSpan);

            const timestampSpan = document.createElement("span");
            timestampSpan.className = `${MessageContentClasses.timestamp} ${MessageContentClasses.timestampInline}`;
            timestampSpan.innerHTML = timestamp; // E.g., "Powered by MagicUpload"
            header.appendChild(timestampSpan);

            messageContainer.appendChild(header);

            if (messageElement instanceof HTMLElement) {
                messageContainer.appendChild(messageElement);
            } else {
                messageContainer.innerText += messageElement; // Fallback if not an element
            }

            messageWrapper.appendChild(messageContainer);
            listItem.appendChild(messageWrapper);
            this.messageContainer = listItem;
        }

        element() {
            return this.messageContainer;
        }

        destination() {
            return this.channelId;
        }

        show() {
            const scrollerInner = document.querySelector(`.${ScrollerClasses.scrollerInner}`);
            const scrollerSpacer = document.querySelector(`.${ScrollerClasses.scrollerSpacer}`);
            if (scrollerInner && scrollerSpacer) {
                scrollerInner.insertBefore(this.messageContainer, scrollerSpacer);
            }
        }

        destroy() {
            if (this.messageContainer) {
                this.messageContainer.remove();
            }
        }
    }

    // Class for displaying a custom Discord attachment upload progress message
    class AttachmentUploadDisplay extends BaseMessageDisplay {
        constructor(channelId, filename, fileSize, initialProgress, onCancel) {
            const containerDiv = document.createElement("div");
            const attachmentComponent = global.BdApi.React.createElement(AttachmentUploadComponent, {
                filename: filename,
                size: fileSize,
                progress: initialProgress,
                onCancelUpload: onCancel
            });
            global.BdApi.ReactDOM.render(attachmentComponent, containerDiv);

            const currentUser = CurrentUserStore.getCurrentUser();
            super(containerDiv, channelId, "Powered by MagicUpload", currentUser.username, Utils.discordAvatarLink(currentUser.id, currentUser.avatar));

            this.attachment = attachmentComponent;
            this.container = containerDiv;
        }

        setProgress(progressValue) {
            const clampedProgress = Math.min(Math.max(progressValue, 0), 100);
            this.attachment.props.progress = clampedProgress; // Update React component props

            // Manually update the DOM for the progress bar (as React won't re-render for prop change here)
            // This relies on internal Discord class names, which can break with updates.
            const progressBarClassName = this.container.innerHTML.match(/class="(progressBar-[^\s"]*)/);
            if (progressBarClassName && progressBarClassName[1]) {
                const progressBarElement = this.container.querySelector(`.${progressBarClassName[1]}`);
                if (progressBarElement) {
                    progressBarElement.style.transform = `translate3d(-${100 - this.attachment.props.progress}%, 0px, 0px)`;
                }
            }
        }

        progress() {
            return this.attachment.props.progress;
        }
    }

    // Main class responsible for handling Google Drive uploads
    class DriveUploader {
        static sendFileLinkMessage(magicFile, fileLink) {
            Utils.log(`Sending file share link to channel: ${magicFile.mu_destination}.`);
            const content = magicFile.mu_content !== "" ? `${magicFile.mu_content}\n${fileLink}` : fileLink;
            MessageSender.sendMessage(magicFile.mu_destination, { content: content, validNonShortcutEmojis: [] });
        }

        constructor(storageManager, oauthManager) {
            this.storage = storageManager;
            this.oauther = oauthManager;
            this.uploadAttachments = {}; // Active upload UI elements
            this.cancelationQueue = {}; // Tracks cancelled uploads by URL

            // Handle channel changes to re-display uploads
            this.handleChannelSelect = ({ channelId }) => this.checkForAttachments(channelId);
            FluxDispatcher.subscribe("CHANNEL_SELECT", this.handleChannelSelect);

            this.continue(); // Attempt to resume any in-progress uploads
        }

        cleanup() {
            FluxDispatcher.unsubscribe("CHANNEL_SELECT", this.handleChannelSelect);
        }

        checkForAttachments(currentChannelId) {
            Object.keys(this.uploadAttachments).forEach(uploadUrl => {
                if (this.uploadAttachments[uploadUrl].destination() === currentChannelId) {
                    // Timeout to ensure Discord UI has rendered
                    setTimeout(() => {
                        this.uploadAttachments[uploadUrl].show();
                    }, 200);
                }
            });
        }

        cancelFileHandler(uploadUrl) {
            return () => {
                this.cancelationQueue[uploadUrl] = true;
            };
        }

        continue() {
            const registeredUploads = this.getRegisteredUploads();
            Object.keys(registeredUploads).forEach(uploadUrl => {
                if (Object.prototype.hasOwnProperty.call(registeredUploads, uploadUrl)) {
                    this.getStreamStatus(uploadUrl, response => {
                        const magicFile = registeredUploads[uploadUrl];
                        switch (response.status) {
                            case HTTP_OK: // Upload completed
                                this.unregisterUpload(uploadUrl);
                                break;
                            case HTTP_PARTIAL_CONTENT: { // Upload in progress, resume
                                Utils.log("Resuming in-progress upload.");
                                const receivedRange = Utils.parseReceivedRange(response.headers.get("Range"));
                                this.streamChunks(uploadUrl, magicFile, receivedRange, (driveItem, uploadedFile, error) => {
                                    this.uploadAttachments[uploadUrl].destroy();
                                    delete this.uploadAttachments[uploadUrl];
                                    this.unregisterUpload(uploadUrl);
                                    if (error === null && driveItem) { // Success
                                        this.storage.patchUploadHistory({
                                            uploadedAt: new Date().toUTCString(),
                                            driveItem: driveItem,
                                            file: uploadedFile
                                        });
                                        Utils.info(`${uploadedFile.name} has been successfully uploaded to Google Drive.`);
                                        this.share(driveItem.id, () => {
                                            Utils.info(`${uploadedFile.name} permissions have been updated to "anyone with link".`);
                                            const fileLink = this.storage.getSettings().directLink ? Utils.directDriveLink(driveItem.id) : Utils.driveLink(driveItem.id);
                                            DriveUploader.sendFileLinkMessage(uploadedFile, fileLink);
                                        });
                                    } else if (error && error.message === UPLOAD_CANCELLED_ERROR) { // Cancelled
                                        Utils.warn("Upload has been cancelled.");
                                        Utils.showInfoToast(`Upload ${Utils.truncate(uploadedFile.name, 35)} has been cancelled`);
                                    } else { // Failed
                                        Utils.error("Upload has failed.");
                                        Utils.showErrorToast(`Upload failed ${Utils.truncate(uploadedFile.name, 35)}`);
                                    }
                                });
                                break;
                            }
                            case HTTP_NOT_FOUND: { // Upload URL expired or file deleted on server, start fresh
                                Utils.warn("Resumable upload URL not found, re-initiating upload.");
                                this.unregisterUpload(uploadUrl); // Clear old URL
                                this.upload(magicFile);
                                break;
                            }
                            default:
                                Utils.warn(`Unhandled status for resumable upload URL: ${response.status}`);
                                // Consider removing if it's an unrecoverable error. For now, leave it.
                        }
                    });
                }
            });
        }

        getRegisteredUploads() {
            return this.storage.load(Config.storage.uploadsKey) || {};
        }

        registerUpload(uploadUrl, magicFile) {
            Utils.log("Registering new file into upload registry.");
            const serializedFile = JSON.parse(JSON.stringify(magicFile)); // Deep copy to avoid reference issues
            const registeredUploads = this.getRegisteredUploads();
            registeredUploads[uploadUrl] = serializedFile;
            this.storage.store(Config.storage.uploadsKey, registeredUploads);
        }

        unregisterUpload(uploadUrl) {
            Utils.log("Unregistering file from upload registry.");
            const registeredUploads = this.getRegisteredUploads();
            delete registeredUploads[uploadUrl];
            this.storage.store(Config.storage.uploadsKey, registeredUploads);
        }

        getStreamStatus(uploadUrl, callback) {
            const requestOptions = Utils.addAuthHeaderToOptions({
                method: "PUT",
                headers: {
                    "Content-Length": 0,
                    "Content-Range": "bytes 0-*/*" // Request current status of the upload
                }
            }, this.storage);

            fetch(uploadUrl, requestOptions)
                .then(response => {
                    callback && callback(response);
                })
                .catch(error => {
                    Utils.error(["Failed to get stream status:", error]);
                    callback && callback({ status: HTTP_INTERNAL_SERVER_ERROR }); // Indicate failure
                });
        }

        streamChunks(uploadUrl, magicFile, startByte, callback) {
            // Create attachment UI if not already present
            if (!this.uploadAttachments[uploadUrl]) {
                this.uploadAttachments[uploadUrl] = new AttachmentUploadDisplay(
                    magicFile.mu_destination,
                    magicFile.name,
                    magicFile.size,
                    (startByte / magicFile.size) * 100, // Initial progress
                    this.cancelFileHandler(uploadUrl)
                );
                this.uploadAttachments[uploadUrl].show();
            }

            const { uploadAttachments, cancelationQueue } = this;
            const accessToken = this.storage.getAccessToken();
            const chunkSize = Config.upload.chunkMultiplier * 256 * 1024; // 2.56 MB chunks
            const buffer = Buffer.alloc(chunkSize);

            Fs.open(magicFile.path, "r", (openError, fileDescriptor) => {
                if (openError || typeof fileDescriptor !== "number") {
                    callback(null, magicFile, openError || new Error("Failed to open file."));
                    return;
                }

                const readFileChunk = (offset) => {
                    if (cancelationQueue[uploadUrl]) {
                        Fs.close(fileDescriptor, () => Utils.log("File stream closed due to cancellation."));
                        callback(null, magicFile, new Error(UPLOAD_CANCELLED_ERROR));
                        return;
                    }

                    Fs.read(fileDescriptor, buffer, 0, chunkSize, offset, (readError, bytesRead) => {
                        if (readError) {
                            Fs.close(fileDescriptor, () => Utils.error("Error closing file after read error."));
                            callback(null, magicFile, readError);
                            return;
                        }

                        let chunkData;
                        if (bytesRead < chunkSize) {
                            chunkData = buffer.slice(0, bytesRead); // Last chunk
                        } else {
                            chunkData = buffer;
                        }

                        const currentOffset = offset;
                        const endOffset = offset + (chunkData.length - 1);
                        const totalSize = magicFile.size;

                        const parsedUrl = new Url.URL(uploadUrl);
                        const requestOptions = {
                            host: parsedUrl.host,
                            path: parsedUrl.pathname + parsedUrl.search,
                            method: "PUT",
                            headers: {
                                Authorization: `Bearer ${accessToken}`,
                                "Content-Length": chunkData.length,
                                "Content-Range": `bytes ${currentOffset}-${endOffset}/${totalSize}`
                            }
                        };

                        Utils.log(`[${(currentOffset / totalSize * 100).toFixed(2)}%] Uploading ${magicFile.name} (${currentOffset}/${totalSize})`);
                        uploadAttachments[uploadUrl].setProgress(currentOffset / totalSize * 100);

                        const req = Https.request(requestOptions, (response) => {
                            if (response.statusCode === HTTP_PARTIAL_CONTENT) {
                                // Google Drive indicates where to resume from
                                const nextOffset = Utils.parseReceivedRange(response.headers.range) + 1;
                                readFileChunk(nextOffset);
                            } else if (response.statusCode === HTTP_OK) {
                                let responseData = "";
                                response.on("data", (chunk) => {
                                    responseData += chunk;
                                });
                                response.on("end", () => {
                                    Fs.close(fileDescriptor, () => { // Close the file after successful upload
                                        Utils.showSuccessToast(`Successfully uploaded ${Utils.truncate(magicFile.name, 35)}`);
                                        callback(JSON.parse(responseData), magicFile, null);
                                    });
                                });
                            } else {
                                // Handle other non-OK status codes as errors
                                Fs.close(fileDescriptor, () => Utils.error("Error closing file after failed chunk upload."));
                                response.on("data", (chunk) => Utils.error(chunk.toString()));
                                response.on("end", () => callback(null, magicFile, new Error(`Upload failed with status code ${response.statusCode}`)));
                            }
                        });

                        req.on("error", (requestError) => {
                            Fs.close(fileDescriptor, () => Utils.error("Error closing file after request error."));
                            Utils.error(["HTTPS request error:", requestError]);
                            callback(null, magicFile, requestError);
                        });

                        req.write(chunkData);
                        req.end();
                    });
                };
                readFileChunk(startByte); // Start reading from the given offset
            });
        }

        share(fileId, successCallback, isRetry = false) {
            const permissionBody = {
                role: GOOGLE_DRIVE_PERMISSION_ROLE_READER,
                type: GOOGLE_DRIVE_PERMISSION_TYPE_ANYONE
            };
            const requestOptions = Utils.addAuthHeaderToOptions({
                method: "POST",
                headers: {
                    "Content-Type": "application/json; charset=UTF-8"
                },
                body: JSON.stringify(permissionBody)
            }, this.storage);

            fetch(`${GOOGLE_DRIVE_FILES_URL}/${fileId}/permissions`, requestOptions)
                .then(response => response.json())
                .then(data => {
                    if (data.error) {
                        if (data.error.code === HTTP_UNAUTHORIZED && !isRetry) {
                            Utils.warn("Authorization token expired during share request, attempting refresh.");
                            this.oauther.refresh(() => {
                                this.share(fileId, successCallback, true); // Retry after refresh
                            });
                        } else {
                            Utils.error(["Failed to set file permissions:", data.error]);
                        }
                    } else {
                        successCallback && successCallback();
                    }
                })
                .catch(error => {
                    Utils.error(["Error sharing file:", error]);
                });
        }

        upload(magicFile, isRetry = false) {
            Utils.info(`Beginning upload for: ${magicFile.name}`);
            const metadata = {
                name: magicFile.name,
                mimeType: magicFile.type
            };
            const requestOptions = Utils.addAuthHeaderToOptions({
                method: "POST",
                headers: {
                    "Content-Type": "application/json; charset=UTF-8",
                    "Content-Length": magicFile.size // Total file size for resumable session
                },
                body: JSON.stringify(metadata)
            }, this.storage);

            fetch(GOOGLE_DRIVE_UPLOAD_RESUMABLE_URL, requestOptions)
                .then(response => {
                    if (response.status === HTTP_OK) {
                        const uploadSessionUrl = response.headers.get("Location");
                        this.registerUpload(uploadSessionUrl, magicFile);
                        this.streamChunks(uploadSessionUrl, magicFile, 0, (driveItem, uploadedFile, error) => {
                            this.uploadAttachments[uploadSessionUrl].destroy();
                            delete this.uploadAttachments[uploadSessionUrl];
                            this.unregisterUpload(uploadSessionUrl);
                            if (error === null && driveItem) { // Success
                                this.storage.patchUploadHistory({
                                    uploadedAt: new Date().toUTCString(),
                                    driveItem: driveItem,
                                    file: uploadedFile
                                });
                                Utils.info(`${uploadedFile.name} has been successfully uploaded to Google Drive.`);
                                this.share(driveItem.id, () => {
                                    Utils.info(`${uploadedFile.name} permissions have been updated to "anyone with link".`);
                                    const fileLink = this.storage.getSettings().directLink ? Utils.directDriveLink(driveItem.id) : Utils.driveLink(driveItem.id);
                                    DriveUploader.sendFileLinkMessage(uploadedFile, fileLink);
                                });
                            } else if (error && error.message === UPLOAD_CANCELLED_ERROR) { // Cancelled
                                Utils.warn("Upload has been cancelled.");
                                Utils.showInfoToast(`Upload ${Utils.truncate(uploadedFile.name, 35)} has been cancelled`);
                            } else { // Failed
                                Utils.error("Upload has failed.");
                                Utils.showErrorToast(`Upload failed ${Utils.truncate(uploadedFile.name, 35)}`);
                            }
                        });
                    } else if (response.status === HTTP_UNAUTHORIZED && !isRetry) {
                        Utils.warn("Authorization token expired during upload initiation, attempting refresh.");
                        this.oauther.refresh(() => {
                            this.upload(magicFile, true); // Retry after refresh
                        });
                    } else {
                        Utils.error(`Failed to initiate resumable upload session: ${response.status}`);
                        Utils.showErrorToast(`Failed to start upload for ${Utils.truncate(magicFile.name, 35)}`);
                    }
                })
                .catch(error => {
                    Utils.error(["Error initiating upload:", error]);
                    Utils.showErrorToast(`Error starting upload for ${Utils.truncate(magicFile.name, 35)}`);
                });
        }
    }

    // Class for managing plugin storage (settings, credentials, history)
    class StorageManager {
        constructor(pluginName) {
            this.pluginName = pluginName;
            const { credentialsKey, uploadHistoryKey, settingsKey, defaultSettings } = Config.storage;

            this.deleteCredentials = () => this.delete(credentialsKey);
            this.getAccessToken = () => {
                const creds = this.load(credentialsKey, true);
                return creds && creds.access_token;
            };
            this.patchAccessToken = (newAccessToken) => {
                const creds = this.load(credentialsKey, true);
                creds.access_token = newAccessToken;
                this.store(credentialsKey, creds, true);
                return newAccessToken;
            };
            this.getUploadHistory = () => this.load(uploadHistoryKey, false) || [];
            this.patchUploadHistory = (entry) => {
                const history = this.getUploadHistory();
                history.push(entry);
                this.store(uploadHistoryKey, history, false);
            };
            this.clearUploadHistory = () => {
                Utils.log("Clearing upload history...");
                this.store(uploadHistoryKey, [], false);
            };
            this.getSettings = () => this.load(settingsKey, false) || defaultSettings;
            this.saveSettings = (settings) => this.store(settingsKey, settings, false);
            this.patchSettings = (partialSettings) => {
                // Uses Lodash merge, which is typically available in BD
                const currentSettings = this.getSettings();
                const updatedSettings = Object.assign({}, currentSettings, partialSettings); // Use Object.assign for simple merge
                this.saveSettings(updatedSettings);
            };
        }

        load(key, decrypt) {
            let data = global.BdApi.loadData(this.pluginName, key);
            if (data && decrypt) {
                const base64Decoded = Buffer.from(data, "base64").toString("ascii");
                data = JSON.parse(Utils.decrypt(JSON.parse(base64Decoded)));
            }
            return data;
        }

        store(key, data, encrypt) {
            let dataToSave;
            if (encrypt) {
                const encrypted = Utils.encrypt(JSON.stringify(data));
                dataToSave = Buffer.from(JSON.stringify(encrypted)).toString("base64");
            } else {
                dataToSave = data;
            }
            global.BdApi.saveData(this.pluginName, key, dataToSave);
        }

        delete(key) {
            global.BdApi.deleteData(this.pluginName, key);
        }
    }

    // Class for managing Google OAuth authentication flow
    class OAuthManager {
        static postAccessToken(code, callback) {
            const params = new Url.URLSearchParams({
                client_id: Config.oauth.clientId,
                client_secret: Config.oauth.clientSecret,
                code: code,
                grant_type: "authorization_code",
                redirect_uri: `http://${Config.oauth.handler.host}:${Config.oauth.handler.port}`
            }).toString();

            fetch(GOOGLE_OAUTH_TOKEN_URL, {
                    method: "POST",
                    headers: { "Content-Type": "application/x-www-form-urlencoded" },
                    body: params
                })
                .then(response => response.json())
                .then(data => {
                    callback && callback(data);
                })
                .catch(error => {
                    Utils.error(["Error fetching access token:", error]);
                    callback && callback({ error: "network_error", error_description: error.message });
                });
        }

        static postRefreshAccessToken(refreshToken, callback) {
            const params = new Url.URLSearchParams({
                client_id: Config.oauth.clientId,
                client_secret: Config.oauth.clientSecret,
                refresh_token: refreshToken,
                grant_type: "refresh_token"
            }).toString();

            fetch(GOOGLE_OAUTH_TOKEN_URL, {
                    method: "POST",
                    headers: { "Content-Type": "application/x-www-form-urlencoded" },
                    body: params
                })
                .then(response => response.json())
                .then(data => {
                    callback && callback(data);
                })
                .catch(error => {
                    Utils.error(["Error refreshing access token:", error]);
                    callback && callback({ error: "network_error", error_description: error.message });
                });
        }

        static postRevokeToken(token) {
            const options = {
                method: "POST",
                headers: { "Content-Type": "application/x-www-form-urlencoded" }
            };
            fetch(`${GOOGLE_OAUTH_REVOKE_URL}?token=${token}`, options)
                .then(response => {
                    if (response.status === HTTP_OK) {
                        Utils.info("OAuth Token has successfully been revoked.");
                    } else {
                        Utils.warn("Unable to revoke OAuth token.");
                    }
                })
                .catch(error => {
                    Utils.error(["Error revoking token:", error]);
                });
        }

        constructor(storageManager, onAuthSuccessCallback, pluginInstance) {
            this.storage = storageManager;
            this.onAuthSuccess = onAuthSuccessCallback; // Callback to re-apply Discord overrides
            this.pluginInstance = pluginInstance; // Reference to the main plugin class

            this.server = Http.createServer((request, response) => {
                const { query } = Url.parse(request.url, true);
                if (query.code) {
                    Utils.log("Received authorization code.");
                    OAuthManager.postAccessToken(query.code, (tokenData) => {
                        if (tokenData.access_token && tokenData.refresh_token) {
                            Utils.log("Exchanged authorization code for access and refresh tokens.");
                            this.storage.store(Config.storage.credentialsKey, tokenData, true);
                            response.writeHead(HTTP_OK, { "Content-Type": "text/html" });
                            response.write(GoogleDriveConnectedPageHtml());
                            Utils.showSuccessToast("Google Drive connected!", { timeout: 5500 });
                            Utils.info("Google Drive successfully linked.");
                            this.onAuthSuccess && this.onAuthSuccess(this.pluginInstance);
                        } else {
                            Utils.error("Failed to retrieve access and refresh tokens.");
                            response.writeHead(HTTP_INTERNAL_SERVER_ERROR, { "Content-Type": "text/html" });
                            response.write(GoogleDriveErrorPageHtml({ error_message: JSON.stringify(tokenData, null, 2) }));
                            Utils.showErrorToast("An error occurred connecting Google Drive", { timeout: 5500 });
                        }
                        response.end();
                        this.cleanup(); // Close the server after handling the request
                    });
                } else if (query.error) {
                    Utils.error(["OAuth error received:", query.error_description || query.error]);
                    response.writeHead(HTTP_INTERNAL_SERVER_ERROR, { "Content-Type": "text/html" });
                    response.write(GoogleDriveErrorPageHtml({ error_message: JSON.stringify(query, null, 2) }));
                    Utils.showErrorToast("An error occurred connecting Google Drive", { timeout: 5500 });
                    response.end();
                    this.cleanup();
                } else {
                    response.writeHead(HTTP_NOT_FOUND);
                    response.end("Not Found");
                }
            });
        }

        launch() {
            this.activateHandler(() => {
                Utils.log("Sending user to OAuth consent flow.");
                window.open(GOOGLE_OAUTH_AUTH_URL);
            });
        }

        activateHandler(callback) {
            if (this.server.listening) {
                callback();
                return;
            }
            const { port, host } = Config.oauth.handler;
            this.server.listen(port, host, () => {
                Utils.log(`Listening for OAuth redirects on http://${host}:${port}...`);
                callback && callback();
            });

            this.server.on('error', (err) => {
                if (err.code === 'EADDRINUSE') {
                    Utils.error(`OAuth handler port ${port} is already in use. Please ensure no other application is using it.`);
                    Utils.showErrorToast(`OAuth handler port ${port} is in use. Check console for details.`, { timeout: 8000 });
                    this.cleanup(); // Attempt to close if somehow it thinks it's listening but got error
                } else {
                    Utils.error(["OAuth handler server error:", err]);
                }
            });
        }

        cleanup(callback) {
            if (this.server.listening) {
                this.server.close(callback);
            } else {
                callback && callback();
            }
        }

        refresh(successCallback) {
            const credentials = this.storage.load(Config.storage.credentialsKey, true);
            const refreshToken = credentials && credentials.refresh_token;

            if (refreshToken) {
                OAuthManager.postRefreshAccessToken(refreshToken, (tokenData) => {
                    const newAccessToken = tokenData.access_token;
                    if (newAccessToken) {
                        Utils.log("Successfully refreshed access token.");
                        this.storage.patchAccessToken(newAccessToken);
                        successCallback && successCallback(newAccessToken);
                    } else {
                        Utils.warn("Refresh token may have expired or is invalid. Please reconnect your Google account.");
                        this.storage.deleteCredentials();
                        this.launch(); // Prompt user to re-authenticate
                    }
                });
            } else {
                Utils.error("Refresh token not found. Something went wrong. Clearing OAuth credentials.");
                this.storage.deleteCredentials();
                this.launch(); // Prompt user to re-authenticate
            }
        }
    }

    // Main BetterDiscord Plugin Class
    return class MagicUploadPlugin {
        getName() {
            return Config.meta.name;
        }

        getAuthor() {
            return Config.meta.authors.map(a => a.name).join(", ");
        }

        getDescription() {
            return Config.meta.description;
        }

        getVersion() {
            return Config.meta.version;
        }

        openOAuthPrompt() {
            global.BdApi.showConfirmationModal(
                "\u{1F50C} Connect your Google Drive",
                "Magic Upload requires Google Drive. To use this plugin you must connect your Google account.", {
                    confirmText: "Connect Google Account",
                    cancelText: "Disable Plugin",
                    onConfirm: () => {
                        this.oauther.launch();
                    },
                    onCancel: () => {
                        global.BdApi.Plugins.disable(this.getName());
                    }
                }
            );
        }

        openUploadPrompt(magicFile, onConfirmCallback) {
            const truncatedName = Utils.truncate(magicFile.name);
            const prettifiedType = Utils.prettifyType(magicFile.type);
            const prettifiedSize = Utils.prettifySize(magicFile.size);

            global.BdApi.showConfirmationModal(
                truncatedName,
                [`Are you sure you want to upload this ${prettifiedType || "file"} (${prettifiedSize}) to Google Drive and share it?`], {
                    confirmText: "Upload to Drive",
                    cancelText: "Cancel",
                    onConfirm: () => {
                        onConfirmCallback();
                    }
                }
            );
        }

        load() {
            // Initialize storage manager, OAuth manager, and uploader
            this.storage = new StorageManager(this.getName());
            this.oauther = new OAuthManager(this.storage, this.overrideDiscordUpload, this);
            this.uploader = new DriveUploader(this.storage, this.oauther);
        }

        overrideDiscordUpload(pluginInstance) {
            const { realUploadLimit, storage, uploader } = pluginInstance;

            Utils.log("Overriding default file upload functionality.");

            // Make maxFileSize return a very large number for MagicUpload's internal check
            Utils.override(FileUploadValidation, "maxFileSize", ({ methodArguments, callOriginalMethod }) => {
                return methodArguments[1] === true ? callOriginalMethod() : Number.MAX_VALUE;
            });

            // Prevent Discord from flagging files as too large or sum too large
            Utils.override(FileUploadValidation, "anyFileTooLarge", () => false);
            Utils.override(FileUploadValidation, "uploadSumTooLarge", () => false);
            Utils.override(FileUploadValidation, "getUploadFileSizeSum", () => 0);

            // Intercept uploadFiles method
            Utils.override(FileUploadManager, "uploadFiles", ({ methodArguments, thisObject, originalMethod }) => {
                const [uploadContext] = methodArguments;
                const { channelId, uploads, parsedMessage } = uploadContext;

                uploads.forEach(uploadItem => {
                    const file = uploadItem.item.file;
                    const magicFile = Utils.convertFileToMagicFile(file, channelId, parsedMessage.content);

                    // Check if file is within Discord's limit AND "Upload Everything" is not enabled
                    if (!storage.getSettings().uploadEverything && file.size < realUploadLimit) {
                        Utils.info(`File "${file.name}" is within Discord's upload limit, using default file uploader.`);
                        const newUploadContext = { ...uploadContext
                        }; // Create a new context for original method
                        newUploadContext.uploads = [uploadItem]; // Only pass this specific file
                        originalMethod.apply(thisObject, [newUploadContext]);
                    } else {
                        Utils.info(`File "${file.name}" exceeds upload limit, using ${Config.meta.name} uploader.`);
                        if (storage.getSettings().autoUpload) {
                            uploader.upload(magicFile);
                        } else {
                            pluginInstance.openUploadPrompt(magicFile, () => uploader.upload(magicFile));
                        }
                    }
                });
            });
        }

        start() {
            Utils.info("MagicUpload has started.");
            // Store Discord's real upload limit for later comparison
            this.realUploadLimit = FileUploadValidation.maxFileSize("", true);

            // Check if user is already authenticated
            if (this.storage.getAccessToken()) {
                this.overrideDiscordUpload(this);
            } else {
                this.openOAuthPrompt(); // Prompt user to connect Google Drive
            }
        }

        stop() {
            Utils.info("MagicUpload has stopped.");
            Utils.clearOverrides(); // Remove all monkey patches
            this.oauther.cleanup(); // Stop OAuth server
            this.uploader.cleanup(); // Unsubscribe from FluxDispatcher
        }

        createSettingsCategory(contentElement) {
            const containerDiv = document.createElement("div");
            containerDiv.className = FormDividerClasses.container;
            containerDiv.appendChild(contentElement);

            const dividerDiv = document.createElement("div");
            dividerDiv.className = `${FormDividerClasses.divider} ${FormDividerClasses.dividerDefault}`;
            dividerDiv.style.borderTop = "thin solid #4f545c7a";
            dividerDiv.style.height = "1px";
            containerDiv.appendChild(dividerDiv);

            return containerDiv;
        }

        createSwitchControl(props) {
            class SwitchComponent extends global.BdApi.React.Component {
                constructor(reactProps) {
                    super(reactProps);
                    this.state = { enabled: this.props.value };
                }

                render() {
                    return global.BdApi.React.createElement(SwitchItem, {
                        ...this.props,
                        value: this.state.enabled,
                        onChange: (newValue) => {
                            this.props.onChange(newValue);
                            this.setState({ enabled: newValue });
                        }
                    });
                }
            }

            const wrapperDiv = document.createElement("div");
            const reactElement = global.BdApi.React.createElement(SwitchComponent, {
                value: props.value,
                children: props.name,
                note: props.note,
                disabled: props.disabled,
                onChange: props.onChange
            });
            global.BdApi.ReactDOM.render(reactElement, wrapperDiv);
            return wrapperDiv;
        }

        createButtonControl(props) {
            const wrapperDiv = document.createElement("div");
            wrapperDiv.style.marginTop = "8px";
            const reactElement = global.BdApi.React.createElement(DiscordButton, {
                children: props.name,
                onClick: props.onClick
            });
            global.BdApi.ReactDOM.render(reactElement, wrapperDiv);
            return wrapperDiv;
        }

        createTextBoxControl(props) {
            const wrapperDiv = document.createElement("div");
            wrapperDiv.style.marginTop = "8px";
            wrapperDiv.style.marginBottom = "20px";

            const reactElement = global.BdApi.React.createElement(TextInput, {
                value: props.value,
                disabled: props.disabled,
                placeholder: props.placeholder || "",
                onChange: props.onChange || (() => {}) // Placeholder for onChange, as text input components usually have one
            });
            global.BdApi.ReactDOM.render(reactElement, wrapperDiv);

            if (props.name) {
                const nameLabel = document.createElement("div");
                nameLabel.innerHTML = props.name;
                nameLabel.style.marginBottom = "8px";
                nameLabel.style.marginTop = "4px";
                nameLabel.style.color = "white";
                nameLabel.style.fontSize = "16px";
                nameLabel.style.fontWeight = "500";
                wrapperDiv.prepend(nameLabel);
            }

            if (props.note) {
                const noteLabel = document.createElement("div");
                noteLabel.innerHTML = props.note;
                noteLabel.style.marginBottom = "12px";
                noteLabel.style.marginTop = "6px";
                noteLabel.style.color = "#b9bbbe";
                noteLabel.style.fontSize = "14px";
                wrapperDiv.appendChild(noteLabel);
            }

            return wrapperDiv;
        }

        createHistoryControl() {
            const uploadHistory = this.storage.getUploadHistory().sort((a, b) => new Date(b.uploadedAt) - new Date(a.uploadedAt));

            const containerDiv = document.createElement("div");

            const header = document.createElement("h1");
            header.innerHTML = `Upload History (${uploadHistory.length})`;
            header.style.color = "#fff";
            header.style.fontWeight = "500";
            header.style.position = "relative";
            header.style.marginBottom = "0.5rem";

            const clearHistorySpan = document.createElement("span");
            clearHistorySpan.innerHTML = "clear history";
            clearHistorySpan.style.position = "absolute";
            clearHistorySpan.style.right = "4px";
            clearHistorySpan.style.cursor = "pointer";
            clearHistorySpan.style.fontSize = "14px";
            clearHistorySpan.style.opacity = "0.4";
            clearHistorySpan.style.textTransform = "uppercase";
            clearHistorySpan.onclick = () => {
                global.BdApi.showConfirmationModal(
                    "Are you sure?",
                    "Are you sure you want to delete the plugin's entire upload history. This will NOT delete any files from Google Drive.", {
                        confirmText: "Clear history",
                        cancelText: "Cancel",
                        onConfirm: () => {
                            this.storage.clearUploadHistory();
                            Utils.showSuccessToast("Upload history cleared. Please refresh settings.");
                        }
                    }
                );
            };
            header.appendChild(clearHistorySpan);
            containerDiv.appendChild(header);

            const historyList = document.createElement("ol");
            historyList.style.maxHeight = "200px";
            historyList.style.backgroundColor = "#2b2e31";
            historyList.style.overflow = "scroll";
            historyList.style.borderRadius = "6px";
            historyList.style.padding = "0.75rem";

            if (uploadHistory.length > 0) {
                uploadHistory.forEach(entry => {
                    const listItem = document.createElement("li");
                    listItem.onmouseover = () => { listItem.style.backgroundColor = "#41444a"; };
                    listItem.onmouseout = () => { listItem.style.backgroundColor = "transparent"; };
                    listItem.style.paddingTop = "1rem";
                    listItem.style.paddingLeft = "0.75rem";
                    listItem.style.paddingRight = "0.75rem";
                    listItem.style.borderRadius = "4px";
                    listItem.style.paddingBottom = "1rem";
                    listItem.style.display = "flex";
                    listItem.style.justifyContent = "space-between";
                    listItem.style.cursor = "pointer";
                    listItem.onclick = () => window.open(Utils.driveLink(entry.driveItem.id));

                    const nameSpan = document.createElement("span");
                    nameSpan.style.fontWeight = "500";
                    nameSpan.innerHTML = `${Utils.truncate(entry.file.name)}`;
                    listItem.appendChild(nameSpan);

                    const sizeSpan = document.createElement("span");
                    sizeSpan.style.fontSize = "14px";
                    sizeSpan.innerHTML = `${Utils.prettifySize(entry.file.size)}`;
                    listItem.appendChild(sizeSpan);

                    historyList.appendChild(listItem);
                });
            } else {
                const noFilesMessage = document.createElement("div");
                noFilesMessage.style.height = "60px";
                noFilesMessage.style.fontSize = "15px";
                noFilesMessage.style.opacity = "0.4";
                noFilesMessage.style.display = "flex";
                noFilesMessage.style.justifyContent = "center";
                noFilesMessage.style.alignItems = "center";
                noFilesMessage.innerHTML = "You haven't uploaded any files yet...";
                historyList.appendChild(noFilesMessage);
            }

            containerDiv.appendChild(historyList);
            return containerDiv;
        }

        getSettingsPanel() {
            const credentials = this.storage.load(Config.storage.credentialsKey, true);
            const settingsDiv = document.createElement("div");
            settingsDiv.style.color = "#b9bbbe";
            settingsDiv.style.fontSize = "16px";
            settingsDiv.style.lineHeight = "18px";

            if (credentials) {
                // Settings Switches
                [{
                    name: "Automatic file uploading",
                    note: "Do not prompt me when uploading files that exceed the upload limit.",
                    value: this.storage.getSettings().autoUpload,
                    disabled: false,
                    onChange: value => { this.storage.patchSettings({ autoUpload: value }); }
                }, {
                    name: "Upload Everything",
                    note: "Use Google Drive for all files, including ones within discords upload limit.",
                    value: this.storage.getSettings().uploadEverything,
                    disabled: false,
                    onChange: value => { this.storage.patchSettings({ uploadEverything: value }); }
                }, {
                    name: "Share direct download link",
                    note: "Share a direct download link to the Google Drive file.",
                    value: this.storage.getSettings().directLink,
                    disabled: false,
                    onChange: value => { this.storage.patchSettings({ directLink: value }); }
                }, {
                    name: "Verbose logs",
                    note: "Display verbose console logs. Useful for debugging.",
                    value: this.storage.getSettings().verbose,
                    disabled: false,
                    onChange: value => { this.storage.patchSettings({ verbose: value }); }
                }, ].forEach(setting => settingsDiv.appendChild(this.createSwitchControl(setting)));

                // Upload History Section
                const historyCategory = this.createSettingsCategory(this.createHistoryControl());
                settingsDiv.appendChild(historyCategory);

                // Token Display (read-only)
                settingsDiv.appendChild(this.createTextBoxControl({
                    name: "Google Drive Access Token",
                    value: credentials.access_token,
                    note: "This value is immutable and auto-refreshed.",
                    disabled: true
                }));
                settingsDiv.appendChild(this.createTextBoxControl({
                    name: "Google Drive Refresh Token",
                    value: credentials.refresh_token,
                    note: "This value is immutable and used to renew your access.",
                    disabled: true
                }));

                // Unlink Button
                settingsDiv.appendChild(this.createButtonControl({
                    name: "Unlink Google Drive",
                    onClick: () => {
                        OAuthManager.postRevokeToken(credentials.refresh_token);
                        this.storage.deleteCredentials();
                        Utils.showInfoToast("Google Drive has been unlinked", { timeout: 5500 });
                        Utils.info("Google Drive has been unlinked.");
                        Utils.closeLastModal(); // Close settings modal
                    }
                }));
            } else {
                // Prompt to connect Google Drive if not authenticated
                const welcomeMessage = document.createElement("div");
                welcomeMessage.style.lineHeight = "20px";
                welcomeMessage.style.fontSize = "18px";
                welcomeMessage.style.marginBottom = "1rem";
                welcomeMessage.innerHTML = `\u{1F50C} Hello! It looks like you haven't given access to your Google Drive. 
          This plugin <i>requires</i> you to sign in with Google in order to function.`;
                settingsDiv.appendChild(welcomeMessage);

                settingsDiv.appendChild(this.createButtonControl({
                    name: "Connect Google Drive",
                    onClick: () => {
                        this.oauther.launch();
                        Utils.closeLastModal();
                    }
                }));
            }

            return settingsDiv;
        }
    };
})();
