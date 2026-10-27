const App = {
    currentDriver: null,
    activeTab: 'markdown',
    lastImage: null,
    selectedId: null,
    isDragging: false,
    dragTarget: null,
    dragOffset: { x: 0, y: 0 },
    orientation: 'portrait',
    landscapeWidth: 576,
    rotationAngle: 0,
    viewMode: 'fit',
    
    init() {
        this.loadDraft();
        this.loadOrientationSettings();
        this.fillDrivers();
        this.bindEvents();
        this.updateOrientationUI();
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
        const feedBtn = document.getElementById('feedBtn');
        if (feedBtn) feedBtn.disabled = true;
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
                    const feedBtn = document.getElementById('feedBtn');
                    if (feedBtn) feedBtn.disabled = false;
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
                    const rotationAngle = this.getEffectiveRotation();
                    const { bytes, height } = Renderer.getBitmapBytes(rotationAngle);
                    const isEn = document.body.classList.contains('en-mode');
                    printBtn.disabled = true;

                    const origBtnHTML = printBtn.innerHTML;
                    printBtn.classList.add('is-printing');

                    for (let c = 1; c <= copies; c++) {
                        const statusMsg = copies > 1
                            ? (isEn ? `Printing... (Copy ${c}/${copies})` : `Yazdırılıyor... (Kopya ${c}/${copies})`)
                            : (isEn ? "Printing..." : "Yazdırılıyor...");
                        document.getElementById('printStatus').innerText = statusMsg;
                        printBtn.innerHTML = `⏳ ${statusMsg}`;

                        await this.currentDriver.print(bytes, height);

                        if (c < copies) {
                            await new Promise(r => setTimeout(r, 700));
                        }
                    }

                    printBtn.innerHTML = isEn ? "✅ Printed!" : "✅ Yazdırıldı!";
                    document.getElementById('printStatus').innerText = isEn ? "Print complete" : "Yazdırma tamamlandı";
                    
                    setTimeout(() => {
                        printBtn.innerHTML = origBtnHTML;
                        printBtn.disabled = false;
                        printBtn.classList.remove('is-printing');
                        const st = document.getElementById('printStatus');
                        if (st && (st.innerText === 'Print complete' || st.innerText === 'Yazdırma tamamlandı')) {
                            st.innerText = "";
                        }
                    }, 1600);
                } catch (e) {
                    alert("Yazdırma hatası: " + e.message);
                    printBtn.disabled = false;
                    printBtn.classList.remove('is-printing');
                    printBtn.innerHTML = `<span class="lang-tr">🖨️ YAZDIR (Ctrl+Enter)</span><span class="lang-en">🖨️ PRINT (Ctrl+Enter)</span>`;
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
            if (e.key === 'Escape') {
                App.closeTemplateModal();
            }
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
            bottomMargin: bMargin,
            orientation: this.orientation || 'portrait',
            landscapeWidth: this.landscapeWidth || 576
        };
        
        if (typeof Renderer !== 'undefined' && Renderer.renderMarkdown) {
            await Renderer.renderMarkdown(textInputEl.value, params);
        }

        const tearEdge = document.querySelector('.paper-tear-edge');
        if (tearEdge && Renderer.canvas) {
            tearEdge.style.setProperty('--tear-width', `${Renderer.canvas.width}px`);
        }
        
        const vSizeEl = document.getElementById('vSize');
        const vOffsetEl = document.getElementById('vOffset');
        const vSpacingEl = document.getElementById('vSpacing');
        const vBMarginEl = document.getElementById('vBMargin');

        if (vSizeEl) vSizeEl.innerText = params.fontSize;
        if (vOffsetEl) vOffsetEl.innerText = params.offsetX;
        if (vSpacingEl) vSpacingEl.innerText = params.lineSpacing;
        if (vBMarginEl) vBMarginEl.innerText = bMargin;

        const warnEl = document.getElementById('landscapeOverflowWarning');
        if (warnEl) {
            const isLandscape = (this.orientation === 'landscape');
            warnEl.classList.toggle('hidden', !(isLandscape && Renderer.isOverflowing));
        }

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

        if (this.orientation === 'landscape') {
            if (type === 'code_only') {
                tpl = `[C][S:36][W:900]**${senderName.toUpperCase()} — ${carrier.toUpperCase()}**
================================================
[C][CODE128:${trackNo.replace(/\s+/g, '')}|0|0|0|0|1.6]
[C][S:30][W:900]**${trackNo}**
================================================
| TARİH: ${dateStr} | SİPARİŞ KARGO PAKETİ |`;
            } else {
                const rName = document.getElementById('cargoReceiverName').value || '';
                const rPhone = document.getElementById('cargoReceiverPhone').value || '';
                const rAddr = document.getElementById('cargoReceiverAddress').value || '';
                const sPhone = document.getElementById('cargoSenderPhone').value || '';

                tpl = `[C][S:32][W:900]**${carrier.toUpperCase()}**
================================================
| GÖNDERİCİ: ${senderName} | TEL: ${sPhone || '-'} |
------------------------------------------------
[C][CODE128:${trackNo.replace(/\s+/g, '')}|0|0|0|0|1.4]
[C][S:26][W:900]**${trackNo}**
------------------------------------------------
| ALICI: ${rName} | TEL: ${rPhone} |
| ADRES: ${rAddr} |
================================================`;
            }
        } else {
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

    loadOrientationSettings() {
        try {
            const savedOrient = localStorage.getItem('mxw01_orientation');
            if (savedOrient === 'landscape' || savedOrient === 'portrait') {
                this.orientation = savedOrient;
            }
            const savedWidth = localStorage.getItem('mxw01_landscape_width');
            if (savedWidth) {
                const w = parseInt(savedWidth);
                if (w >= 384 && w <= 1200) {
                    this.landscapeWidth = w;
                }
            }
            const savedRot = localStorage.getItem('mxw01_rotation_angle');
            if (savedRot !== null) {
                const r = parseInt(savedRot);
                if ([0, 90, 180, 270].includes(r)) {
                    this.rotationAngle = r;
                }
            } else {
                this.rotationAngle = (this.orientation === 'landscape') ? 90 : 0;
            }
            const savedView = localStorage.getItem('mxw01_view_mode');
            if (savedView === 'fit' || savedView === 'actual') {
                this.viewMode = savedView;
            }
        } catch (e) {}
    },

    toggleViewMode() {
        this.viewMode = (this.viewMode === 'fit') ? 'actual' : 'fit';
        try {
            localStorage.setItem('mxw01_view_mode', this.viewMode);
        } catch (e) {}
        this.updateViewModeUI();
    },

    updateViewModeUI() {
        const wrapper = document.getElementById('canvasWrapper');
        const btn = document.getElementById('btnZoomToggle');
        const isEn = document.body.classList.contains('en-mode');
        if (wrapper) {
            wrapper.classList.toggle('fit-mode', this.viewMode === 'fit');
            wrapper.classList.toggle('actual-mode', this.viewMode === 'actual');
        }
        if (btn) {
            if (this.viewMode === 'fit') {
                btn.innerText = '🔍 %100';
                btn.title = isEn ? 'Switch to 100% Actual Size' : '%100 Gerçek Boyuta Geç';
            } else {
                btn.innerText = '📐 Sığdır';
                btn.title = isEn ? 'Fit Preview to Column' : 'Önizlemeyi Sütuna Sığdır';
            }
        }
    },

    autoFitLandscape() {
        if (this.orientation !== 'landscape') {
            this.setOrientation('landscape');
        }

        const fontSizeEl = document.getElementById('fontSize');
        const lineSpacingEl = document.getElementById('lineSpacing');
        const bottomMarginEl = document.getElementById('bottomMargin');
        if (!fontSizeEl || !lineSpacingEl) return;

        let curFont = parseInt(fontSizeEl.value) || 20;
        let curSpacing = parseFloat(lineSpacingEl.value) || 1.1;
        let curMargin = bottomMarginEl ? (parseInt(bottomMarginEl.value) || 25) : 25;

        const targetH = 384;
        let currentH = (typeof Renderer !== 'undefined' && Renderer.contentHeight) 
            ? Renderer.contentHeight 
            : (Renderer && Renderer.canvas ? Renderer.canvas.height : 400);

        if (currentH <= targetH && !(Renderer && Renderer.isOverflowing)) {
            const isEn = document.body.classList.contains('en-mode');
            const statusEl = document.getElementById('autoSaveStatus');
            if (statusEl) {
                statusEl.innerText = isEn ? '✅ Already fits within 384px limit!' : '✅ İçerik zaten 384px rulo sınırına uygun!';
                statusEl.style.opacity = '1';
                setTimeout(() => { if (statusEl) statusEl.style.opacity = '0.7'; }, 2000);
            }
            return;
        }

        // Orantılı küçültme faktörü
        const ratio = Math.min(0.92, (targetH / currentH) * 0.96);
        const newFont = Math.max(12, Math.floor(curFont * ratio));
        const newSpacing = Math.max(0.7, Math.min(curSpacing, parseFloat((curSpacing * ratio).toFixed(1))));
        const newMargin = Math.max(10, Math.floor(curMargin * ratio));

        fontSizeEl.value = newFont;
        lineSpacingEl.value = newSpacing;
        if (bottomMarginEl) bottomMarginEl.value = newMargin;

        this.updatePreview();

        // 2. mikro-optimizasyon adımı
        setTimeout(() => {
            if (Renderer && Renderer.isOverflowing && parseInt(fontSizeEl.value) > 12) {
                fontSizeEl.value = Math.max(12, parseInt(fontSizeEl.value) - 1);
                if (parseFloat(lineSpacingEl.value) > 0.8) {
                    lineSpacingEl.value = (parseFloat(lineSpacingEl.value) - 0.1).toFixed(1);
                }
                this.updatePreview();
            }

            const isEn = document.body.classList.contains('en-mode');
            const statusEl = document.getElementById('autoSaveStatus');
            if (statusEl) {
                statusEl.innerText = isEn ? '✅ Auto-fitted to 384px roll height!' : '✅ 384px rulo yüksekliğine otomatik sığdırıldı!';
                statusEl.style.opacity = '1';
                setTimeout(() => { if (statusEl) statusEl.style.opacity = '0.7'; }, 2000);
            }
        }, 60);
    },

    applyTemplate(key, skipConfirm = false) {
        if (!key) return;
        const textarea = document.getElementById('textInput');
        if (!textarea) return;

        const isEn = document.body.classList.contains('en-mode');
        const currentVal = (textarea.value || '').trim();

        // Güvenlik denetimi: Düzenleyicide mevcut içerik varsa üzerine yazmadan önce sor
        if (!skipConfirm && currentVal.length > 25) {
            const msg = isEn 
                ? "Your current receipt/note text will be replaced with this template. Continue?" 
                : "Mevcut fiş/not içeriğiniz bu şablonla değiştirilecek. Onaylıyor musunuz?";
            if (!confirm(msg)) return;
        }
        const now = new Date();
        const pad = (n) => String(n).padStart(2, '0');
        const dateStr = `${pad(now.getDate())}.${pad(now.getMonth()+1)}.${now.getFullYear()}`;
        const timeStr = `${pad(now.getHours())}:${pad(now.getMinutes())}`;

        const templates = {
            cat_photo_note: {
                orientation: 'portrait',
                width: 384,
                rotation: 0,
                fontSize: 20,
                lineSpacing: 1.15,
                bottomMargin: 25,
                text: `[C][S:34][W:900]🐾 **HEY, WHAT'S UP!** 🐾
================================
[C][S:20]Everything is going well! ✨
--------------------------------
[C][S:24][W:900]**GÜNÜN NOTU**
* Bugün harika bir gün olacak!
* Kendine inan ve gülümse 😊
* Bol su içmeyi unutma 💧
* Hayallerinin peşinden git! ✨
--------------------------------
[C][S:20]🐱 "Miyav! Başarı seninle!"
[C][QR:https://instagram.com|0|0|0|0|0.55]
[C][S:16]Tarih: ${dateStr} • Saat: ${timeStr}
================================`
            },
            cat_todo: {
                orientation: 'portrait',
                width: 384,
                rotation: 0,
                fontSize: 18,
                lineSpacing: 1.2,
                bottomMargin: 25,
                text: `[C][S:34][W:900]🐱 **GÜNLÜK GÖREVLER** 🐱
================================
[C][S:16]Tarih: ${dateStr} | Hedef: %100 Odak
--------------------------------
[ ] Sabah yürüyüşü & meditasyon
[ ] Önemli e-postaları yanıtla
[ ] Proje raporunu tamamla
[ ] 20 sayfa kitap oku
[ ] 2 litre su tüket
[ ] Gün sonu değerlendirmesi
--------------------------------
[C][S:22][W:900]**"Küçük adımlar,**
[C][S:22][W:900]**büyük başarılar getirir!"**
================================
[C][S:14]🐾 Cat Pocket Printer • ${timeStr}`
            },
            cat_study: {
                orientation: 'portrait',
                width: 384,
                rotation: 0,
                fontSize: 18,
                lineSpacing: 1.15,
                bottomMargin: 25,
                text: `[C][S:32][W:900]📚 **DERS & ÇALIŞMA NOTU** 📚
================================
[C][S:18]Konu: Formüller & Özet Bilgiler
--------------------------------
[W:900]**1. TEMEL FORMÜLLER:**
• Hipotenüs: a² + b² = c²
• Hız = Yol / Zaman (v = x / t)
• Kuvvet = Kütle × İvme (F = m·a)
• Enerji = Kütle × c² (E = m·c²)
--------------------------------
[W:900]**2. DİKKAT EDİLECEKLER:**
! Birim dönüşümlerini unutma
! Eksi işaretlerine dikkat et
! Süreyi iyi yönet
================================
[C][S:18]⭐ Sınavda Başarılar! ⭐`
            },
            cat_shopping: {
                orientation: 'portrait',
                width: 384,
                rotation: 0,
                fontSize: 18,
                lineSpacing: 1.2,
                bottomMargin: 25,
                text: `[C][S:34][W:900]🛒 **ALIŞVERİŞ LİSTESİ** 🛒
================================
[C][S:16]Tarih: ${dateStr} • ${timeStr}
--------------------------------
[ ] Süt & Peynir (Kahvaltılık)
[ ] Yumurta (Organik 15'li)
[ ] Ekmek & Yulaf Ezmesi
[ ] Elma, Muz & Çilek
[ ] Domates, Salatalık, Yeşillik
[ ] Termal Kâğıt Rulosu (57mm)
[ ] Kedi Maması & Ödül Maması 🐱
--------------------------------
[C][S:18]Afiyet olsun & İyi alışverişler! ❤︎
================================`
            },
            portrait_default: {
                orientation: 'portrait',
                width: 384,
                rotation: 0,
                fontSize: 20,
                lineSpacing: 1.1,
                bottomMargin: 25,
                text: `[C][S:38][W:900]**MEMONEX 3D**
================================
* Alışverişiniz için teşekkürler!
* Memnun kaldıysanız değerli
* yorumlarınızı paylaşmanız
* bizi çok mutlu eder. ❤︎
--------------------------------
[C][S:28]- 0531 208 48 97 -
[C][QR:memonex3d.com|0|0|0|0|0.6]
[C][S:20]memonex3d.com`
            },
            portrait_pos: {
                orientation: 'portrait',
                width: 384,
                rotation: 0,
                fontSize: 18,
                lineSpacing: 1.1,
                bottomMargin: 25,
                text: `[C][S:36][W:900]**MEMONEX 3D**
[C][S:16]Teknoloji & Tasarım Atölyesi
================================
[C][S:18]SATIŞ BİLGİ FİŞİ
--------------------------------
Tarih: ${dateStr}        Saat: ${timeStr}
Fiş No: 2026-0042      Kasa: 01
--------------------------------
| Ürün | Ad | Fiyat | Toplam |
| 3D Figür Model | 1 | 250 TL | 250 TL |
| PLA Filament 1kg | 2 | 450 TL | 900 TL |
| Nozzle 0.4mm Pirinç | 3 | 40 TL | 120 TL |
--------------------------------
[R][S:16]Ara Toplam: 1.270,00 TL
[R][S:16]KDV (%20): 254,00 TL
[R][S:24][W:900]**GENEL TOPLAM: 1.524,00 TL**
================================
[C][S:16]* Bizi tercih ettiğiniz için teşekkürler!
[C][S:14]Değerli yorumlarınızı bekliyoruz ❤︎
[C][QR:https://memonex3d.com|0|0|0|0|0.6]
[C][S:16]memonex3d.com • 0531 208 48 97`
            },
            portrait_cargo: {
                orientation: 'portrait',
                width: 384,
                rotation: 0,
                fontSize: 18,
                lineSpacing: 1.1,
                bottomMargin: 25,
                text: `[C][S:32][W:900]**YURTİÇİ KARGO**
[C][S:16]STANDART GÖNDERİ SEVK FİŞİ
================================
[C][CODE128:YK202610190842|0|0|0|0|1.5]
[C][S:22][W:900]**YK-2026-1019-0842**
--------------------------------
**GÖNDERİCİ:**
Memonex 3D Ltd. Şti.
Kadıköy / İstanbul - 0216 555 00 11
--------------------------------
**ALICI:**
Ahmet Yılmaz
Atatürk Mah. Cumhuriyet Cad. No:14/2
Çankaya / Ankara
Tel: 0532 111 22 33
--------------------------------
Paket: 1 Koli / 2.4 Desi
Ödeme: Gönderici Ödemeli
================================
[C][QR:https://yurticikargo.com/takip/YK202610190842|0|0|0|0|0.5]
[C][S:14]Kargo Takip için QR Kodu Okutunuz`
            },
            portrait_cafe: {
                orientation: 'portrait',
                width: 384,
                rotation: 0,
                fontSize: 18,
                lineSpacing: 1.1,
                bottomMargin: 25,
                text: `[C][S:34][W:900]**COFFEE & BAKERY**
[C][S:16]Artisan Roasters & Cafe
================================
[C][S:22][W:900]**MASA: 07**
[C][S:16]Garson: Deniz • ${dateStr} ${timeStr}
--------------------------------
| Sipariş | Ad | Fiyat |
| Flat White (Yulaf Sütü) | 2 | 240 TL |
| San Sebastian Cheesecake | 1 | 185 TL |
| Filtre Kahve (Büyük) | 1 | 95 TL |
| Su (Cam Şişe) | 2 | 60 TL |
--------------------------------
[R][S:16]Ara Toplam: 580,00 TL
[R][S:16]Servis (%10): 58,00 TL
[R][S:24][W:900]**TOPLAM: 638,00 TL**
================================
[C][S:16]Wi-Fi: CoffeeGuest / Şifre: espresso2026
[C][QR:https://instagram.com|0|0|0|0|0.5]
[C][S:14]Afiyet Olsun! Bizi etiketleyin @cafename`
            },
            landscape_cargo: {
                orientation: 'landscape',
                width: 640,
                rotation: 90,
                fontSize: 18,
                lineSpacing: 1.0,
                bottomMargin: 20,
                text: `[C][S:30][W:900]**TRENDYOL EXPRESS - HIZLI SEVK ETİKETİ**
============================================================
| GÖNDERİCİ: Memonex 3D San. Tic. | TARİH: ${dateStr} | DESİ: 1.5 |
| TAKİP NO: 7248 1092 8472        | ÇIKIŞ: İST-KADIKÖY MERKEZ |
------------------------------------------------------------
[C][CODE128:724810928472|0|0|0|0|1.8]
[C][S:24][W:900]**7248 1092 8472**
------------------------------------------------------------
| ALICI: Zeynep Kaya             | TEL: 0544 987 65 43       |
| ADRES: Barbaros Bulv. No:88 D:5 Beşiktaş / İstanbul        |
============================================================`
            },
            landscape_table: {
                orientation: 'landscape',
                width: 720,
                rotation: 90,
                fontSize: 16,
                lineSpacing: 1.0,
                bottomMargin: 20,
                text: `[C][S:28][W:900]**HAFTALIK MANAV & MARKET FİYAT LİSTESİ**
[C][S:16]Güncelleme Tarihi: ${dateStr} • Taze ve Yerli Ürünler
============================================================
| Ürün Kodu | Ürün Adı | Menşei | Birim | Fiyat |
| MNV-01 | Amasya Elması (Kırmızı) | Amasya | Kg | 45,00 TL |
| MNV-02 | Finike Portakalı | Antalya | Kg | 35,00 TL |
| MNV-03 | Yerli Muz (Anamur) | Mersin | Kg | 85,00 TL |
| MNV-04 | Deveci Armudu | Bursa | Kg | 60,00 TL |
| MNV-05 | Çilek (Kokulu Sera) | Aydın | Paket | 70,00 TL |
============================================================
[C][S:16]**Tüm fiyatlarımıza KDV dahildir. • İyi Alışverişler Dileriz!**`
            },
            landscape_shelf: {
                orientation: 'landscape',
                width: 576,
                rotation: 90,
                fontSize: 18,
                lineSpacing: 1.0,
                bottomMargin: 20,
                text: `[C][S:32][W:900]**PREMIUM KABLOSUZ GAMING MOUSE**
[C][S:18]RGB Aydınlatmalı • 16000 DPI • Çift Modlu Bağlantı
============================================================
| REYON: 04-A | RAF: 2 | KDV DAHİL FİYAT: **899,00 TL** |
------------------------------------------------------------
[C][CODE128:8690123456789|0|0|0|0|1.6]
[C][S:22][W:900]**8690123456789**
------------------------------------------------------------
| Üretim: Türkiye | Son Değişiklik: ${dateStr} | Garanti: 2 Yıl |
============================================================`
            },
            landscape_ticket: {
                orientation: 'landscape',
                width: 640,
                rotation: 90,
                fontSize: 17,
                lineSpacing: 1.0,
                bottomMargin: 20,
                text: `[C][S:30][W:900]**TEKNOLOJİ VE İNOVASYON ZİRVESİ 2026**
[C][S:18]Giriş Kartı & Katılımcı Akreditasyonu
============================================================
| KATILIMCI: Dr. Selim Özkan | FİRMA: Alpha Bilişim Ltd.    |
| KATEGORİ: VIP Konuşmacı     | SALON: Ana Konferans A      |
------------------------------------------------------------
[C][QR:TICKET-VIP-2026-SELIM-OZKAN|0|0|0|0|0.7]
[C][S:20][W:900]**KOD: VIP-99420-TK**
------------------------------------------------------------
| Tarih: ${dateStr} | Saat: 09:30 | Yer: Kongre Merkezi Haliç |
============================================================`
            }
        };

        const tpl = templates[key];
        if (!tpl) return;

        textarea.value = tpl.text;

        const fontSizeEl = document.getElementById('fontSize');
        const lineSpacingEl = document.getElementById('lineSpacing');
        const bottomMarginEl = document.getElementById('bottomMargin');
        if (fontSizeEl && tpl.fontSize) fontSizeEl.value = tpl.fontSize;
        if (lineSpacingEl && tpl.lineSpacing) lineSpacingEl.value = tpl.lineSpacing;
        if (bottomMarginEl && tpl.bottomMargin) bottomMarginEl.value = tpl.bottomMargin;

        if (tpl.orientation === 'landscape') {
            this.landscapeWidth = tpl.width || 576;
            this.setOrientation('landscape');
            this.setRotation(tpl.rotation || 90);
        } else {
            this.setOrientation('portrait');
            this.setRotation(tpl.rotation || 0);
        }

        this.saveDraft();
        this.updatePreview();
    },

    loadLandscapeSample() {
        this.applyTemplate('landscape_cargo');
    },

    setOrientation(mode) {
        this.orientation = (mode === 'landscape') ? 'landscape' : 'portrait';
        if (this.orientation === 'landscape') {
            if (this.rotationAngle !== 90 && this.rotationAngle !== 270) {
                this.rotationAngle = 90;
            }
        } else {
            if (this.rotationAngle !== 0 && this.rotationAngle !== 180) {
                this.rotationAngle = 0;
            }
        }
        try {
            localStorage.setItem('mxw01_orientation', this.orientation);
            localStorage.setItem('mxw01_rotation_angle', this.rotationAngle);
        } catch (e) {}

        this.updateOrientationUI();
        this.updatePreview();
    },

    setLandscapeWidth(w) {
        const width = Math.max(384, Math.min(1200, parseInt(w) || 576));
        this.landscapeWidth = width;
        try {
            localStorage.setItem('mxw01_landscape_width', width);
        } catch (e) {}

        const slider = document.getElementById('landscapeWidth');
        if (slider) slider.value = width;

        this.updateOrientationUI();
        this.updatePreview();
    },

    onLandscapeWidthChange(val) {
        this.setLandscapeWidth(val);
    },

    cycleRotation() {
        const angles = (this.orientation === 'landscape') ? [90, 270] : [0, 180];
        const currentIdx = Math.max(0, angles.indexOf(this.rotationAngle));
        const nextAngle = angles[(currentIdx + 1) % angles.length];
        this.setRotation(nextAngle);
    },

    setRotation(angle) {
        const a = parseInt(angle) || 0;
        this.rotationAngle = a;
        try {
            localStorage.setItem('mxw01_rotation_angle', a);
        } catch (e) {}

        if ((a === 90 || a === 270) && this.orientation !== 'landscape') {
            this.orientation = 'landscape';
            try { localStorage.setItem('mxw01_orientation', 'landscape'); } catch (e) {}
        } else if ((a === 0 || a === 180) && this.orientation !== 'portrait') {
            this.orientation = 'portrait';
            try { localStorage.setItem('mxw01_orientation', 'portrait'); } catch (e) {}
        }

        this.updateOrientationUI();
        this.updatePreview();
    },

    getEffectiveRotation() {
        if (this.orientation === 'landscape') {
            return (this.rotationAngle === 270) ? 270 : 90;
        } else {
            return (this.rotationAngle === 180) ? 180 : 0;
        }
    },

    updateOrientationUI() {
        const isLandscape = (this.orientation === 'landscape');

        // Ayarlar sütunu butonları
        const btnPortrait = document.getElementById('btnOrientPortrait');
        const btnLandscape = document.getElementById('btnOrientLandscape');
        if (btnPortrait) btnPortrait.classList.toggle('active', !isLandscape);
        if (btnLandscape) btnLandscape.classList.toggle('active', isLandscape);

        // Önizleme başlığı hızlı butonları
        const qPortrait = document.getElementById('quickOrientPortrait');
        const qLandscape = document.getElementById('quickOrientLandscape');
        if (qPortrait) qPortrait.classList.toggle('active', !isLandscape);
        if (qLandscape) qLandscape.classList.toggle('active', isLandscape);

        // Canvas wrapper'a yatay mod sınıfı ver (sağ kenarda dikey yırtma efekti için)
        const wrapper = document.getElementById('canvasWrapper');
        if (wrapper) wrapper.classList.toggle('is-landscape', isLandscape);

        // Yatay ve dikey ayar panelleri görünürlüğü
        const lGroup = document.getElementById('landscapeSettingsGroup');
        const pGroup = document.getElementById('portraitSettingsGroup');
        if (lGroup) lGroup.classList.toggle('hidden', !isLandscape);
        if (pGroup) pGroup.classList.toggle('hidden', isLandscape);

        // Değer etiketleri
        const vWidth = document.getElementById('vLandscapeWidth');
        const vCm = document.getElementById('vLandscapeCm');
        if (vWidth) vWidth.innerText = this.landscapeWidth;
        if (vCm) vCm.innerText = ((this.landscapeWidth / 8) / 10).toFixed(1);

        const slider = document.getElementById('landscapeWidth');
        if (slider) slider.value = this.landscapeWidth;

        // Preset butonları aktifliği
        document.querySelectorAll('.landscape-presets .btn-preset').forEach(btn => {
            const btnW = parseInt(btn.dataset.w) || parseInt(btn.innerText);
            btn.classList.toggle('active', btnW === this.landscapeWidth);
        });

        // Rotasyon hap butonları aktifliği
        document.querySelectorAll('.rotation-pill-group .btn-rot-pill').forEach(btn => {
            const btnAngle = parseInt(btn.dataset.angle);
            btn.classList.toggle('active', btnAngle === this.rotationAngle);
        });

        // Hızlı rotasyon etiketi
        const qAngleLabel = document.getElementById('quickAngleLabel');
        if (qAngleLabel) {
            qAngleLabel.innerText = `${this.rotationAngle}°`;
        }

        this.updateViewModeUI();
    },

    updatePaperMetrics() {
        const canvas = document.getElementById('mainCanvas');
        if (!canvas) return;
        const w = canvas.width;
        const h = canvas.height;
        const isEn = document.body.classList.contains('en-mode');
        const isLandscape = (this.orientation === 'landscape');

        // Termal rulo tüketimi: Dikeyde h piksel beslenir, yatayda 90° çevrildiği için w piksel beslenir
        const rollDots = isLandscape ? w : h;
        const cm = (rollDots / 80).toFixed(1);
        const sec = (rollDots / 350).toFixed(1);
        
        const mLength = document.getElementById('metricLength');
        const mTime = document.getElementById('metricTime');
        const mDots = document.getElementById('metricDots');
        
        if (mLength) mLength.innerText = `📏 ~${cm} cm`;
        if (mTime) mTime.innerText = isEn ? `⏱️ ~${sec} s` : `⏱️ ~${sec} sn`;
        if (mDots) {
            if (isLandscape) {
                mDots.innerText = isEn ? `${w}×${h} px (Landscape)` : `${w}×${h} px (Yatay)`;
            } else {
                mDots.innerText = `${w}×${h} px (Dikey)`;
            }
        }
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

    openTemplateModal() {
        const modal = document.getElementById('templateModal');
        if (modal) modal.classList.remove('hidden');
    },

    closeTemplateModal() {
        const modal = document.getElementById('templateModal');
        if (modal) modal.classList.add('hidden');
    },

    selectTemplateFromModal(key) {
        this.closeTemplateModal();
        this.applyTemplate(key, false);
    },

    resetDefaultTemplate() {
        const isEn = document.body.classList.contains('en-mode');
        if (confirm(isEn ? "Reset to default receipt template?" : "Varsayılan fiş şablonuna dönmek istiyor musunuz?")) {
            this.applyTemplate('portrait_default');
        }
    },

    async feedPaper(lines = 48) {
        if (!this.currentDriver) return;
        const feedBtn = document.getElementById('feedBtn');
        const isEn = document.body.classList.contains('en-mode');
        const statusEl = document.getElementById('printStatus');
        const origBtnText = feedBtn ? feedBtn.innerHTML : '';
        try {
            if (feedBtn) {
                feedBtn.disabled = true;
                feedBtn.innerHTML = isEn ? "⏳ Feeding..." : "⏳ İlerliyor...";
            }
            if (statusEl) statusEl.innerText = isEn ? "Feeding paper..." : "Kâğıt ilerletiliyor...";

            if (typeof this.currentDriver.feedPaper === 'function') {
                await this.currentDriver.feedPaper(lines);
            }

            if (feedBtn) feedBtn.innerHTML = isEn ? "✅ Done" : "✅ İlerletildi";
            if (statusEl) statusEl.innerText = "";
            
            setTimeout(() => {
                if (feedBtn) {
                    feedBtn.innerHTML = origBtnText;
                    feedBtn.disabled = false;
                }
            }, 1200);
        } catch (err) {
            console.error("Feed hatası:", err);
            if (statusEl) statusEl.innerText = isEn ? "Feed error!" : "İlerletme hatası!";
            if (feedBtn) {
                feedBtn.innerHTML = origBtnText;
                feedBtn.disabled = false;
            }
        }
    },

    downloadReceiptImage() {
        const canvas = document.getElementById('mainCanvas');
        if (!canvas) return;
        const now = new Date();
        const pad = (n) => String(n).padStart(2, '0');
        const orientTag = (this.orientation === 'landscape') ? 'yatay' : 'dikey';
        const filename = `termal_fis_${orientTag}_${now.getFullYear()}${pad(now.getMonth()+1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}.png`;

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