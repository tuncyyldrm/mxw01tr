const App = {
    currentDriver: null,
    activeTab: 'markdown',
    lastImage: null,
    selectedId: null,
    isDragging: false,
    dragTarget: null,
    dragOffset: { x: 0, y: 0 },
    
    init() {
        this.loadDraft();
        this.fillDrivers();
        this.bindEvents();
        this.updatePreview();
        this.canvas = document.getElementById('mainCanvas');
        if (this.canvas) {
            this.canvas.onmousedown = (e) => {
                const pt = this.getCanvasPoint(e);
                const target = ImageManager.findImageAt(pt.x, pt.y);
                
                if (target) {
                    this.selectedId = target.id;
                    ImageManager.selectedId = target.id;
                    
                    this.isDragging = false; 
                    this.dragTarget = target;
                    this.dragTarget.startX = target.x;
                    this.dragTarget.startY = target.y;
                    
                    this.dragOffset = { 
                        x: pt.x - target.x, 
                        y: pt.y - target.y 
                    };
                    
                    this.updatePreview();
                    this.syncControls(target);
                    
                    const controls = document.getElementById('imgControls');
                    if (controls) controls.classList.remove('hidden');
                } else {
                    this.selectedId = null;
                    ImageManager.selectedId = null;
                    const controls = document.getElementById('imgControls');
                    if (controls) controls.classList.add('hidden');
                    this.updatePreview();
                }
            };
        }
        App.checkUrlLang();
        App.initPhotoPreview();
    },

    initPhotoPreview() {
        const btn = document.querySelector('.view-real-btn');
        const overlay = document.getElementById('realPhotoOverlay');
        const canvas = document.getElementById('mainCanvas');
        
        if (!btn || !overlay || !canvas) return;

        btn.addEventListener('mouseenter', () => {
            overlay.style.width = `${canvas.offsetWidth}px`;
            overlay.style.height = `${canvas.offsetHeight}px`;
            overlay.style.top = `${canvas.offsetTop}px`;
            overlay.style.left = `${canvas.offsetLeft}px`;
            overlay.classList.remove('hidden');
        });
        
        btn.addEventListener('mouseleave', () => {
            overlay.classList.add('hidden');
        });
    },

    fillDrivers() {
        const sel = document.getElementById('driverSelect');
        if (!sel || typeof PrinterRegistry === 'undefined') return;
        sel.innerHTML = '';
        for (let key in PrinterRegistry) {
            sel.add(new Option(PrinterRegistry[key].name, key));
        }
    },

    onPrinterDisconnected() {
        const isEn = document.body.classList.contains('en-mode');
        const statusEl = document.getElementById('status');
        if (statusEl) {
            statusEl.innerText = isEn ? "Status: Disconnected" : "Durum: Bağlantı kesildi";
        }
        const printBtn = document.getElementById('printBtn');
        if (printBtn) printBtn.disabled = true;
        const printStatus = document.getElementById('printStatus');
        if (printStatus) printStatus.innerText = "";
        const badge = document.getElementById('printerBadge');
        if (badge) badge.classList.add('hidden');
    },

    onPrinterStatus(info) {
        if (!info) return;
        const badge = document.getElementById('printerBadge');
        if (!badge) return;

        badge.classList.remove('hidden');

        const badgeName = document.getElementById('badgeName');
        const badgeBattery = document.getElementById('badgeBattery');
        const badgeStatus = document.getElementById('badgeStatus');
        const isEn = document.body.classList.contains('en-mode');

        if (badgeName && info.name) {
            badgeName.innerText = info.name;
        }

        badge.classList.remove('warning', 'danger');

        if (badgeBattery) {
            if (info.battery !== null && info.battery !== undefined) {
                let icon = '🔋';
                if (info.battery <= 20) icon = '🪫';
                badgeBattery.innerText = `${icon} %${info.battery}`;

                if (info.battery <= 15) {
                    badge.classList.add('danger');
                } else if (info.battery <= 30) {
                    badge.classList.add('warning');
                }
            } else {
                badgeBattery.innerText = '🔋 --%';
            }
        }

        if (badgeStatus) {
            if (info.noPaper) {
                badgeStatus.innerText = isEn ? '⚠️ Out of Paper' : '⚠️ Kâğıt Yok';
                badge.classList.remove('warning');
                badge.classList.add('danger');
            } else {
                badgeStatus.innerText = isEn ? '📄 Paper Ready' : '📄 Kâğıt Hazır';
            }
        }
    },

    bindEvents() {
        // 1. Bağlantı butonu
        const connectBtn = document.getElementById('connectBtn');
        if (connectBtn) {
            connectBtn.onclick = async () => {
                try {
                    const driverKey = document.getElementById('driverSelect').value;
                    this.currentDriver = PrinterRegistry[driverKey].driver;
                    const name = await this.currentDriver.connect();
                    document.getElementById('status').innerText = "🟢 " + name;
                    document.getElementById('printBtn').disabled = false;
                    if (typeof this.currentDriver.updateStatus === 'function') {
                        setTimeout(() => this.currentDriver.updateStatus(), 400);
                    }
                } catch (e) { 
                    alert("Bağlantı hatası: " + e.message); 
                }
            };
        }
        
        // 2. Yazdırma butonu
        // 2. Yazdırma butonu (Çoklu kopya desteği)
        const printBtn = document.getElementById('printBtn');
        if (printBtn) {
            printBtn.onclick = async () => {
                try {
                    const copiesEl = document.getElementById('printCopies');
                    const copies = copiesEl ? Math.max(1, parseInt(copiesEl.value) || 1) : 1;
                    const { bytes, height } = Renderer.getBitmapBytes();
                    const isEn = document.body.classList.contains('en-mode');
                    printBtn.disabled = true;

                    for (let c = 1; c <= copies; c++) {
                        const statusMsg = copies > 1
                            ? (isEn ? `Printing... (Copy ${c}/${copies})` : `Yazdırılıyor... (Kopya ${c}/${copies})`)
                            : (isEn ? "Printing..." : "Yazdırılıyor...");
                        document.getElementById('printStatus').innerText = statusMsg;

                        await this.currentDriver.print(bytes, height);

                        if (c < copies) {
                            await new Promise(r => setTimeout(r, 700));
                        }
                    }

                    document.getElementById('printStatus').innerText = isEn ? "Ready to print" : "Yazdırmaya hazır";
                    printBtn.disabled = false;
                } catch (e) {
                    alert("Yazdırma hatası: " + e.message);
                    printBtn.disabled = false;
                    document.getElementById('printStatus').innerText = "";
                }
            };
        }
        
        // 3. Sekmeler (Tabs)
        document.querySelectorAll('.tab-btn').forEach(btn => {
            btn.onclick = () => {
                document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
                document.querySelectorAll('.tab-content').forEach(c => c.classList.add('hidden'));
                
                btn.classList.add('active');
                this.activeTab = btn.dataset.tab;
                const targetTab = document.getElementById(this.activeTab + '-tab');
                if (targetTab) targetTab.classList.remove('hidden');
                
                if (this.activeTab === 'markdown') {
                    const textarea = document.getElementById('textInput');
                    if (textarea) {
                        const currentVal = textarea.value;
                        textarea.value = ""; 
                        textarea.value = currentVal;
                    }
                } else if (this.activeTab === 'cargo') {
                    this.toggleCargoFields();
                }
                
                this.updatePreview();
            };
        });
        
        // 4. Girişler ve parametreler
        ['textInput', 'fontSize', 'lineSpacing', 'offsetX', 'fontFamily', 'bottomMargin'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.oninput = () => this.updatePreview();
        });

        // Araç çubuğu butonlarına tıklandığında metin seçiminin kaybolmasını engelle
        const toolbar = document.getElementById('editorToolbar');
        if (toolbar) {
            toolbar.addEventListener('mousedown', (e) => {
                if (e.target.tagName !== 'SELECT' && e.target.tagName !== 'OPTION') {
                    e.preventDefault();
                }
            });
        }

        // Klavye Kısayolları (Ctrl+Enter: Yazdır, Ctrl+B: Kalın, Ctrl+I: İtalik)
        window.addEventListener('keydown', (e) => {
            if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
                e.preventDefault();
                const pBtn = document.getElementById('printBtn');
                if (pBtn && !pBtn.disabled) {
                    pBtn.click();
                }
            }
            if ((e.ctrlKey || e.metaKey) && (e.key === 'b' || e.key === 'B')) {
                const textarea = document.getElementById('textInput');
                if (document.activeElement === textarea) {
                    e.preventDefault();
                    this.applyFormat('bold');
                }
            }
            if ((e.ctrlKey || e.metaKey) && (e.key === 'i' || e.key === 'I')) {
                const textarea = document.getElementById('textInput');
                if (document.activeElement === textarea) {
                    e.preventDefault();
                    this.applyFormat('italic');
                }
            }
        });

        window.onmousemove = (e) => {
            if (this.dragTarget) {
                const pt = this.getCanvasPoint(e);
                
                const currentX = pt.x - this.dragOffset.x;
                const currentY = pt.y - this.dragOffset.y;
                
                if (!this.isDragging && (Math.abs(currentX - this.dragTarget.startX) > 3)) {
                    this.isDragging = true;
                    this.dragTarget.mode = 1; 
                }
                
                if (this.isDragging) {
                    this.dragTarget.x = currentX;
                    this.dragTarget.y = currentY;
                    
                    this.updateObjectInText(this.dragTarget);
                    this.syncControls(this.dragTarget);
                    this.updatePreview();
                }
            }
        };
        
        window.onmouseup = () => {
            this.isDragging = false;
            this.dragTarget = null;
        };      
        
        // 5. Pano (Clipboard) üzerinden görsel yapıştırma
        window.addEventListener('paste', (e) => {
            this.handlePaste(e);
        }, true);

        // 6. Sürükle ve Bırak (Drag & Drop) Desteği
        window.addEventListener('dragover', (e) => e.preventDefault());
        window.addEventListener('drop', (e) => e.preventDefault());

        ['mainCanvas', 'dropZone'].forEach(id => {
            const el = document.getElementById(id);
            if (!el) return;
            el.addEventListener('dragover', (e) => {
                e.preventDefault();
                el.style.opacity = '0.7';
            });
            el.addEventListener('dragleave', () => {
                el.style.opacity = '1.0';
            });
            el.addEventListener('drop', (e) => {
                e.preventDefault();
                el.style.opacity = '1.0';
                if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]) {
                    const file = e.dataTransfer.files[0];
                    if (file.type.startsWith('image/')) {
                        ImageManager.importImage(file);
                    }
                }
            });
        });
    },

    handlePaste(e) {
        if (!e.clipboardData || !e.clipboardData.items) return;
        const item = Array.from(e.clipboardData.items).find(x => x.type.indexOf('image') !== -1);
        if (!item) return;
        
        e.preventDefault();
        
        const blob = item.getAsFile();
        const imgId = `img${Object.keys(ImageManager.storage || {}).length + 1}`;
        
        ImageManager.process(blob, imgId).then(() => {
            const newTag = `[IMG:${imgId}|0|0|0|0|1.0]`;
            this.insertTagAtCursor(newTag);
            this.selectedId = imgId;
            this.syncControls({ id: imgId, mode: 0, x: 0, y: 0, rotate: 0, scale: 1.0 });
            
            const controls = document.getElementById('imgControls');
            if (controls) controls.classList.remove('hidden');
            
            ImageManager.updateUI();
            this.updatePreview(); 
        });
    },

    async updatePreview() {
        const fontSizeEl = document.getElementById('fontSize');
        const lineSpacingEl = document.getElementById('lineSpacing');
        const offsetXEl = document.getElementById('offsetX');
        const fontFamilyEl = document.getElementById('fontFamily');
        const textInputEl = document.getElementById('textInput');
        const bottomMarginEl = document.getElementById('bottomMargin');

        if (!fontSizeEl || !lineSpacingEl || !offsetXEl || !fontFamilyEl || !textInputEl) return;

        const bMargin = bottomMarginEl ? parseInt(bottomMarginEl.value) : 25;

        const params = {
            fontSize: parseInt(fontSizeEl.value),
            lineSpacing: parseFloat(lineSpacingEl.value),
            offsetX: parseInt(offsetXEl.value),
            fontFamily: fontFamilyEl.value,
            bottomMargin: bMargin
        };
        
        if (typeof Renderer !== 'undefined' && Renderer.renderMarkdown) {
            await Renderer.renderMarkdown(textInputEl.value, params);
        }
        
        const vSizeEl = document.getElementById('vSize');
        const vOffsetEl = document.getElementById('vOffset');
        const vSpacingEl = document.getElementById('vSpacing');
        const vBMarginEl = document.getElementById('vBMargin');

        if (vSizeEl) vSizeEl.innerText = params.fontSize;
        if (vOffsetEl) vOffsetEl.innerText = params.offsetX;
        if (vSpacingEl) vSpacingEl.innerText = params.lineSpacing;
        if (vBMarginEl) vBMarginEl.innerText = bMargin;

        this.updatePaperMetrics();
        this.saveDraft();
    },

    applyImgChanges() {
        if (!this.selectedId) return;
        
        const isFlow = document.getElementById('imgMode').checked;
        const s = parseFloat(document.getElementById('imgScale').value);
        const r = parseInt(document.getElementById('imgRotate').value);
        const x = parseInt(document.getElementById('imgOffset').value);
        
        const currentPos = Renderer.lastRenderedPositions ? Renderer.lastRenderedPositions[this.selectedId] : null;
        if (!currentPos) return;
        
        const updatedObj = {
            id: this.selectedId,
            mode: isFlow ? 0 : 1, 
            x: x,
            y: currentPos.y,
            rotate: r,
            scale: s
        };
        
        this.updateObjectInText(updatedObj);
        this.updatePreview();
    },

    syncControls(imgData) {
        document.getElementById('imgMode').checked = (imgData.mode === 0);
        document.getElementById('imgScale').value = imgData.scale || 1.0;
        document.getElementById('imgRotate').value = imgData.rotate || 0;
        document.getElementById('imgOffset').value = imgData.x || 0;
    },

    selectImage(id) {
        this.selectedId = id;
        ImageManager.selectedId = id;
        
        const pos = Renderer.lastRenderedPositions ? Renderer.lastRenderedPositions[id] : null;
        
        if (pos) {
            const imgData = {
                id: id,
                scale: pos.s,
                rotate: pos.r,
                x: pos.x,
                y: pos.y,
                mode: pos.mode
            };
            
            this.syncControls(imgData);
            
            const controls = document.getElementById('imgControls');
            if (controls) controls.classList.remove('hidden');
        }
        
        ImageManager.updateUI();
        this.updatePreview();
    },

    escapeRegex(str) {
        return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    },

    detachFromFlow(id, newX, newY) {
        const textarea = document.getElementById('textInput');
        if (!textarea) return;

        const rawId = id.replace(/^(qr_|code128_)/, '');
        const regex = new RegExp(`\\[(IMG|QR|CODE128):(${this.escapeRegex(rawId)})\\|0\\|`, 'g');

        if (regex.test(textarea.value)) {
            const roundedX = Math.round(newX);
            const roundedY = Math.round(newY);
            textarea.value = textarea.value.replace(regex, `[$1:${rawId}|1|${roundedX}|${roundedY}|`);
            this.updatePreview();
        }
    },

    updateObjectInText(obj) {
        const textarea = document.getElementById('textInput');
        if (!textarea || !obj || !obj.id) return;

        const rawId = obj.id.replace(/^(qr_|code128_)/, '');
        const regex = new RegExp(`\\[(IMG|QR|CODE128):(${this.escapeRegex(rawId)})(?:\\|([^\\]]*))?\\]`, 'g');

        const roundedX = Math.round(obj.x || 0);
        const roundedY = Math.round(obj.y || 0);
        const scale = obj.scale !== undefined ? obj.scale : 1.0;
        const rotate = obj.rotate || 0;
        const mode = obj.mode !== undefined ? obj.mode : 0;

        const newTag = `[$1:${rawId}|${mode}|${roundedX}|${roundedY}|${rotate}|${scale}]`;
        textarea.value = textarea.value.replace(regex, newTag);
    },

    insertTagAtCursor(tag) {
        const textarea = document.getElementById('textInput');
        if (!textarea) return;

        const start = textarea.selectionStart;
        const end = textarea.selectionEnd;
        const text = textarea.value;
        
        const before = text.substring(0, start);
        const after = text.substring(end);
        
        const prefix = (before.length > 0 && !before.endsWith('\n')) ? '\n' : '';
        const suffix = (!after.startsWith('\n')) ? '\n' : '';
        
        textarea.value = before + prefix + tag + suffix + after;
        
        textarea.focus();
        this.updatePreview();
    },

    handleFileSelect(input) {
        if (input.files && input.files[0]) {
            ImageManager.importImage(input.files[0]);
        }
    },

    promptUrl() {
        const isEn = document.body.classList.contains('en-mode');
        const msg = isEn ? "Enter direct image URL (e.g. https://...):" : "Resmin doğrudan URL adresini girin (örn: https://...):";
        const url = prompt(msg);
        if (url && url.trim()) {
            ImageManager.importImage(url.trim());
        }
    },

    getCanvasPoint(e) {
        if (!this.canvas) return { x: 0, y: 0 };
        const rect = this.canvas.getBoundingClientRect();
        
        const scaleX = this.canvas.width / rect.width;
        const scaleY = this.canvas.height / rect.height;
        
        return {
            x: (e.clientX - rect.left) * scaleX,
            y: (e.clientY - rect.top) * scaleY
        };
    },

    setLanguage(lang, skipHistory = false) {
        const textarea = document.getElementById('textInput');
        if (lang === 'en') {
            document.body.classList.add('en-mode');
            const swEn = document.getElementById('sw-en');
            const swTr = document.getElementById('sw-tr');
            if (swEn) swEn.classList.add('active');
            if (swTr) swTr.classList.remove('active');
            if (textarea) textarea.placeholder = "Example:\n# TITLE\n[IMG:/logo.jpg]\n[QR: https://example.com]...";
        } else {
            document.body.classList.remove('en-mode');
            const swTr = document.getElementById('sw-tr');
            const swEn = document.getElementById('sw-en');
            if (swTr) swTr.classList.add('active');
            if (swEn) swEn.classList.remove('active');
            if (textarea) textarea.placeholder = "Örnek:\n# BAŞLIK\n[IMG:/logo.jpg]\n[QR: https://example.com]...";
        }
        if (!skipHistory) {
            const newUrl = lang === 'en' ? '?lang=en' : window.location.pathname;
            window.history.pushState({ lang: lang }, '', newUrl);
        }
    },

    checkUrlLang() {
        const urlParams = new URLSearchParams(window.location.search);
        const lang = urlParams.get('lang');
        
        if (lang === 'en') {
            App.setLanguage('en', true);
        } else {
            App.setLanguage('tr', true);
        }
    },

    toggleCargoFields() {
        const typeEl = document.getElementById('cargoLabelType');
        if (!typeEl) return;

        const type = typeEl.value;
        const receiverFields = document.getElementById('receiverFieldsGroup');
        const senderPhoneParam = document.getElementById('senderPhoneParam');
        const carrierInput = document.getElementById('cargoCarrier');

        if (type === 'code_only') {
            if (receiverFields) receiverFields.classList.add('hidden-cargo-field');
            if (senderPhoneParam) senderPhoneParam.classList.add('hidden-cargo-field');
            if (carrierInput) carrierInput.value = "TRENDYOL GÖNDERİ PAKETİ";
        } else {
            if (receiverFields) receiverFields.classList.remove('hidden-cargo-field');
            if (senderPhoneParam) senderPhoneParam.classList.remove('hidden-cargo-field');
            if (carrierInput) carrierInput.value = "YURTİÇİ KARGO";
        }
    },

    generateCargoLabel() {
        const type = document.getElementById('cargoLabelType').value;
        const carrier = document.getElementById('cargoCarrier').value || '';
        const trackNo = document.getElementById('cargoTrackNo').value || '';
        const senderName = document.getElementById('cargoSenderName').value || '';
        const now = new Date();
        const dateStr = now.toLocaleDateString('tr-TR');

        let tpl = '';

        if (type === 'code_only') {
            tpl = `[C][S:48][W:900]**${senderName.toUpperCase()}**
================================
[C][S:23][W:900]**${carrier.toUpperCase()}**
================================
[C][CODE128:${trackNo.replace(/\s+/g, '')}|0|0|0|0|1.4]
[C][S:35][W:900]**${trackNo}**
================================
[C][S:24][W:700]${dateStr}`;
        } else {
            const rName = document.getElementById('cargoReceiverName').value || '';
            const rPhone = document.getElementById('cargoReceiverPhone').value || '';
            const rAddr = document.getElementById('cargoReceiverAddress').value || '';
            const sPhone = document.getElementById('cargoSenderPhone').value || '';

            tpl = `[C][S:36][W:900]**${carrier.toUpperCase()}**
[C][S:35]${trackNo}
================================
[S:22]**ALICI:** ${rName}
[S:22]Tel: ${rPhone}
[S:22]Adres: ${rAddr}

================================
[S:26]**GÖNDERİCİ:** ${senderName}
[S:22]Tel: ${sPhone}
================================
[C][QR:memonex3d.com|0|0|0|0|0.5]`;
        }

        const textarea = document.getElementById('textInput');
        if (textarea) textarea.value = tpl;
        
        const markdownTabBtn = document.querySelector('.tab-btn[data-tab="markdown"]');
        if (markdownTabBtn) markdownTabBtn.click();
        
        this.saveDraft();
        if (typeof this.updatePreview === 'function') {
            this.updatePreview();
        }
    },

    getTextareaSelection() {
        const textarea = document.getElementById('textInput');
        if (!textarea) return null;
        const start = textarea.selectionStart;
        const end = textarea.selectionEnd;
        const text = textarea.value;
        const selectedText = text.substring(start, end);
        return { textarea, start, end, text, selectedText };
    },

    insertAtCursor(before, after = '', defaultText = '') {
        const sel = this.getTextareaSelection();
        if (!sel) return;
        const { textarea, start, end, selectedText } = sel;
        const content = selectedText || defaultText;
        const replacement = before + content + after;

        textarea.focus();
        textarea.setRangeText(replacement, start, end, 'select');

        if (!selectedText && defaultText) {
            textarea.setSelectionRange(start + before.length, start + before.length + defaultText.length);
        } else {
            const nextPos = start + replacement.length;
            textarea.setSelectionRange(nextPos, nextPos);
        }

        this.updatePreview();
    },

    applyFormat(type) {
        const isEn = document.body.classList.contains('en-mode');
        switch (type) {
            case 'bold':
                this.insertAtCursor('**', '**', isEn ? 'Bold Text' : 'Kalın Metin');
                break;
            case 'italic':
                this.insertAtCursor('*', '*', isEn ? 'Italic Text' : 'İtalik Metin');
                break;
            case 'center':
                this.insertAtCursor('[C]', '', isEn ? 'Centered Text' : 'Ortalanmış Metin');
                break;
            case 'right':
                this.insertAtCursor('[R]', '', isEn ? 'Right Aligned Text' : 'Sağa Yaslı Metin');
                break;
            case 'box': {
                const sel = this.getTextareaSelection();
                const needsLeadingNL = sel && sel.start > 0 && sel.text[sel.start - 1] !== '\n';
                const needsTrailingNL = sel && sel.end < sel.text.length && sel.text[sel.end] !== '\n';
                const prefix = (needsLeadingNL ? '\n' : '') + '[BOX]\n';
                const suffix = '\n[/BOX]' + (needsTrailingNL ? '\n' : '\n');
                this.insertAtCursor(prefix, suffix, isEn ? 'Box Content' : 'Kutu İçeriği');
                break;
            }
            case 'bullet': {
                const sel = this.getTextareaSelection();
                const needsLeadingNL = sel && sel.start > 0 && sel.text[sel.start - 1] !== '\n';
                const prefix = (needsLeadingNL ? '\n' : '') + '* ';
                this.insertAtCursor(prefix, '', isEn ? 'Bullet item' : 'Madde Metni');
                break;
            }
        }
    },

    applySize(val) {
        if (!val) return;
        const isEn = document.body.classList.contains('en-mode');
        this.insertAtCursor(`[${val}]`, '', isEn ? 'Heading Text' : 'Başlık Metni');
    },

    insertDivider(type) {
        if (!type) return;
        let dividerLine = '--------------------------------';
        if (type === '===') dividerLine = '================================';
        else if (type === '~~~') dividerLine = '~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~';
        else if (type === '...') dividerLine = '................................';

        const sel = this.getTextareaSelection();
        if (!sel) return;
        const { textarea, start, end, text } = sel;

        const needsLeadingNL = start > 0 && text[start - 1] !== '\n';
        const needsTrailingNL = end < text.length && text[end] !== '\n';

        const insertStr = (needsLeadingNL ? '\n' : '') + dividerLine + (needsTrailingNL ? '\n' : '\n');

        textarea.focus();
        textarea.setRangeText(insertStr, start, end, 'end');
        this.updatePreview();
    },

    insertDateTime() {
        const now = new Date();
        const pad = (n) => String(n).padStart(2, '0');
        const dateStr = `${pad(now.getDate())}.${pad(now.getMonth() + 1)}.${now.getFullYear()} ${pad(now.getHours())}:${pad(now.getMinutes())}`;
        this.insertAtCursor(dateStr, '');
    },

    promptInsertQR() {
        const isEn = document.body.classList.contains('en-mode');
        const msg = isEn ? "Enter text or web URL for QR code:" : "QR koda dönüştürülecek metin veya web bağlantısını girin:";
        const text = prompt(msg, "https://");
        if (!text || text.trim() === '') return;
        const clean = text.trim();
        const sel = this.getTextareaSelection();
        if (!sel) return;
        const { start, end, text: curText } = sel;
        const needsLeadingNL = start > 0 && curText[start - 1] !== '\n';
        const needsTrailingNL = end < curText.length && curText[end] !== '\n';
        const qrTag = `${needsLeadingNL ? '\n' : ''}[C][QR:${clean}|0|0|0|0|0.6]${needsTrailingNL ? '\n' : '\n'}`;
        this.insertAtCursor(qrTag, '');
    },

    promptInsertBarcode() {
        const isEn = document.body.classList.contains('en-mode');
        const msg = isEn ? "Enter barcode data (CODE128):" : "Barkod verisini girin (CODE128):";
        const code = prompt(msg, "1234567890");
        if (!code || code.trim() === '') return;
        const clean = code.trim();
        const sel = this.getTextareaSelection();
        if (!sel) return;
        const { start, end, text: curText } = sel;
        const needsLeadingNL = start > 0 && curText[start - 1] !== '\n';
        const needsTrailingNL = end < curText.length && curText[end] !== '\n';
        const bcTag = `${needsLeadingNL ? '\n' : ''}[C][CODE128:${clean}|0|0|0|0|1.2]${needsTrailingNL ? '\n' : '\n'}`;
        this.insertAtCursor(bcTag, '');
    },

    insertSampleTable() {
        const sel = this.getTextareaSelection();
        if (!sel) return;
        const { start, end, text: curText } = sel;
        const needsLeadingNL = start > 0 && curText[start - 1] !== '\n';
        const needsTrailingNL = end < curText.length && curText[end] !== '\n';
        const isEn = document.body.classList.contains('en-mode');
        const sample = isEn
            ? `${needsLeadingNL ? '\n' : ''}| Item | Qty | Price |\n| Apple | 2 | $4.00 |\n| Orange | 1 | $2.50 |${needsTrailingNL ? '\n' : '\n'}`
            : `${needsLeadingNL ? '\n' : ''}| Ürün | Adet | Fiyat |\n| Çilek | 2 | 50 TL |\n| Elma | 1 | 30 TL |${needsTrailingNL ? '\n' : '\n'}`;
        this.insertAtCursor(sample, '');
    },

    async refreshPrinterStatus() {
        if (!this.currentDriver) return;
        const badgeStatus = document.getElementById('badgeStatus');
        const oldText = badgeStatus ? badgeStatus.innerText : '';
        const isEn = document.body.classList.contains('en-mode');
        if (badgeStatus) badgeStatus.innerText = isEn ? '⏳ Refreshing...' : '⏳ Yenileniyor...';
        try {
            if (typeof this.currentDriver.updateStatus === 'function') {
                await this.currentDriver.updateStatus();
            }
        } catch (e) {
            console.warn("Durum yenilenemedi:", e);
            if (badgeStatus) badgeStatus.innerText = oldText;
        }
    },

    updatePaperMetrics() {
        const canvas = document.getElementById('mainCanvas');
        if (!canvas) return;
        const h = canvas.height;
        const cm = (h / 80).toFixed(1);
        const sec = (h / 350).toFixed(1);
        
        const mLength = document.getElementById('metricLength');
        const mTime = document.getElementById('metricTime');
        const mDots = document.getElementById('metricDots');
        
        if (mLength) mLength.innerText = `📏 ~${cm} cm`;
        if (mTime) mTime.innerText = `⏱️ ~${sec} sn`;
        if (mDots) mDots.innerText = `384×${h} px`;
    },

    saveDraft() {
        const textarea = document.getElementById('textInput');
        if (!textarea) return;
        try {
            localStorage.setItem('mxw01_editor_draft', textarea.value);
            const statusEl = document.getElementById('autoSaveStatus');
            if (statusEl) {
                const isEn = document.body.classList.contains('en-mode');
                statusEl.innerText = isEn ? '💾 Draft saved' : '💾 Taslak kaydedildi';
                statusEl.style.opacity = '1';
                setTimeout(() => { if (statusEl) statusEl.style.opacity = '0.7'; }, 1000);
            }
        } catch (e) {}
    },

    loadDraft() {
        try {
            const draft = localStorage.getItem('mxw01_editor_draft');
            if (draft !== null && draft.trim() !== '') {
                const textarea = document.getElementById('textInput');
                if (textarea) textarea.value = draft;
            }
        } catch (e) {}
    },

    clearEditor() {
        const isEn = document.body.classList.contains('en-mode');
        if (confirm(isEn ? "Clear all editor content?" : "Tüm düzenleyici içeriğini temizlemek istiyor musunuz?")) {
            const textarea = document.getElementById('textInput');
            if (textarea) {
                textarea.value = '';
                this.saveDraft();
                this.updatePreview();
            }
        }
    },

    resetDefaultTemplate() {
        const isEn = document.body.classList.contains('en-mode');
        if (confirm(isEn ? "Reset to default receipt template?" : "Varsayılan fiş şablonuna dönmek istiyor musunuz?")) {
            const textarea = document.getElementById('textInput');
            const defaultTpl = `[C][S:38][W:900]**MEMONEX 3D**
================================
* Alışverişiniz için teşekkürler!
* Memnun kaldıysanız değerli
* yorumlarınızı paylaşmanız
* bizi çok mutlu eder. ❤︎
--------------------------------
[C][S:28]- 0531 208 48 97 -
[C][QR:memonex3d.com|0|0|0|0|0.6]
[C][S:20]memonex3d.com`;
            if (textarea) {
                textarea.value = defaultTpl;
                this.saveDraft();
                this.updatePreview();
            }
        }
    },

    downloadReceiptImage() {
        const canvas = document.getElementById('mainCanvas');
        if (!canvas) return;
        const now = new Date();
        const pad = (n) => String(n).padStart(2, '0');
        const filename = `termal_fis_${now.getFullYear()}${pad(now.getMonth()+1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}.png`;

        const link = document.createElement('a');
        link.download = filename;
        link.href = canvas.toDataURL('image/png');
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    }
};

window.App = App;
window.onload = () => App.init();