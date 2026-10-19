const Renderer = {
    canvas: document.getElementById('mainCanvas'),
    get ctx() { return this.canvas.getContext('2d'); },
    lastRenderedPositions: {},
    tagRegex: /\[(IMG|QR|CODE128):([^\|\]]+)(?:\|([^\]]*))?\]/g,
    _loading: {},

    style: {
        fontSize: 16,
        lineSpacing: 1.2,
        fontFamily: 'Arial',
        currentSize: 16,
        isBold: true
    },

    ensureResourceLoaded(type, id, storageId) {
        if (this._loading[storageId] || (ImageManager.storage && ImageManager.storage[storageId])) return;
        
        this._loading[storageId] = true;

        const finalize = (img) => {
            if (!ImageManager.storage) ImageManager.storage = {};
            ImageManager.storage[storageId] = img;
            delete this._loading[storageId];
            
            if (typeof App !== 'undefined' && typeof App.updatePreview === 'function') {
                App.updatePreview();
            }
        };

        if (type === 'QR') {
            if (typeof QRCode === 'undefined') {
                console.error("QR Code kütüphanesi yüklü değil!");
                delete this._loading[storageId];
                return;
            }

            const qrCanvas = document.createElement('canvas');
            QRCode.toCanvas(qrCanvas, id, { 
                width: 240,
                margin: 2,
                color: { dark: "#000000", light: "#ffffff" },
                errorCorrectionLevel: 'M'
            }, (err) => {
                if (err) {
                    delete this._loading[storageId];
                    return;
                }
                const img = new Image();
                img.onload = () => finalize(img);
                img.src = qrCanvas.toDataURL('image/png');
            });

        } else if (type === 'CODE128') {
            // CODE128 için JsBarcode kullanarak arka planda Canvas üzerinde barkod üretimi
            if (typeof JsBarcode === 'undefined') {
                console.error("JsBarcode kütüphanesi yüklü değil!");
                delete this._loading[storageId];
                return;
            }

            try {
                const barcodeCanvas = document.createElement('canvas');
                JsBarcode(barcodeCanvas, id, {
                    format: "CODE128",
                    displayValue: false,
                    margin: 0,
                    height: 60,
                    width: 2
                });

                const img = new Image();
                img.onload = () => finalize(img);
                img.src = barcodeCanvas.toDataURL('image/png');
            } catch (err) {
                console.error("CODE128 oluşturma hatası:", err);
                delete this._loading[storageId];
            }

        } else {
            ImageManager.importImage(id, storageId)
                .then(() => {
                    delete this._loading[storageId];
                    if (typeof App !== 'undefined') App.updatePreview();
                })
                .catch((err) => {
                    console.error("Görsel yükleme başarısız:", id, err);
                    delete this._loading[storageId];
                });
        }
    },

    drawLine(type, y) {
        this.ctx.save();
        this.ctx.beginPath();
        this.ctx.strokeStyle = 'black';
        this.ctx.setLineDash([]);
        this.ctx.lineCap = 'square';

        const startX = 5;
        const endX = (this.canvasWidth || 384) - 5;
        const centerY = Math.round(y + 8);

        if (type === '---') { 
            this.ctx.lineWidth = 1;
            this.ctx.moveTo(startX, centerY);
            this.ctx.lineTo(endX, centerY);
        } 
        else if (type === '===') { 
            this.ctx.lineWidth = 1.5;
            this.ctx.moveTo(startX, centerY - 2);
            this.ctx.lineTo(endX, centerY - 2);
            this.ctx.moveTo(startX, centerY + 2);
            this.ctx.lineTo(endX, centerY + 2);
        } 
        else if (type === '~~~') { 
            this.ctx.lineWidth = 1.2;
            this.ctx.moveTo(startX, centerY);
            const step = 4;
            const amplitude = 3;
            for (let x = startX; x <= endX; x += step) {
                const nextY = centerY + Math.sin((x - startX) / 6) * amplitude;
                this.ctx.lineTo(x, nextY);
            }
        } 
        else if (type === '...') { 
            this.ctx.lineWidth = 1.5;
            this.ctx.setLineDash([4, 4]); 
            this.ctx.moveTo(startX, centerY);
            this.ctx.lineTo(endX, centerY);
        }

        this.ctx.stroke();
        this.ctx.restore();
    },

    drawTable(line, currentY, isReal) {
        const columns = line.split('|').map(c => c.trim()).filter(c => c !== '');
        if (columns.length === 0) return 0;

        const CANVAS_WIDTH = this.canvasWidth || 384;
        const PADDING = 4;
        const colWidth = (CANVAS_WIDTH - 10) / columns.length;

        // Markdown tablo ayraç satırı kontrolü: |---|---|---|
        const isHeaderDivider = columns.every(c => /^[-:]+$/.test(c));
        if (isHeaderDivider) {
            if (isReal) {
                this.ctx.save();
                this.ctx.beginPath();
                this.ctx.strokeStyle = '#000';
                this.ctx.lineWidth = 1;
                this.ctx.setLineDash([2, 2]);
                this.ctx.moveTo(5, currentY + 4);
                this.ctx.lineTo(CANVAS_WIDTH - 5, currentY + 4);
                this.ctx.stroke();
                this.ctx.restore();
            }
            return 8;
        }

        const fontStack = `${this.style.fontFamily}, sans-serif`;
        const cellLineHeight = this.style.fontSize * this.style.lineSpacing;

        // Her sütundaki metinleri saralım
        const cellData = columns.map(col => {
            const maxWidth = Math.max(20, colWidth - (PADDING * 2));
            const wrapped = this.wrapText(col, maxWidth);
            return wrapped.length > 0 ? wrapped : [''];
        });

        const maxLines = Math.max(1, ...cellData.map(c => c.length));
        const rowHeight = maxLines * cellLineHeight;

        if (isReal) {
            this.ctx.save();
            this.ctx.imageSmoothingEnabled = false;

            columns.forEach((col, index) => {
                const x = 5 + (index * colWidth);
                const isLastCol = (index === columns.length - 1);
                const lines = cellData[index];

                lines.forEach((tLine, lineIdx) => {
                    const lineY = currentY + (lineIdx * cellLineHeight);
                    const cleanTxt = tLine.replace(/\*\*|\*|_/g, '');
                    this.ctx.font = `600 ${this.style.fontSize}px ${fontStack}`;
                    const textWidth = this.ctx.measureText(cleanTxt).width;
                    const drawX = (isLastCol && columns.length > 1) 
                        ? (x + colWidth - PADDING - textWidth) 
                        : (x + PADDING);

                    this.renderStyledText(
                        tLine,
                        Math.round(drawX),
                        Math.round(lineY),
                        this.style.fontSize,
                        fontStack,
                        false,
                        null,
                        '600'
                    );
                });

                if (index > 0) {
                    this.ctx.beginPath();
                    this.ctx.setLineDash([2, 2]);
                    this.ctx.moveTo(x, currentY - 2);
                    this.ctx.lineTo(x, currentY + rowHeight);
                    this.ctx.strokeStyle = '#888';
                    this.ctx.stroke();
                }
            });
            this.ctx.restore();
        }

        return rowHeight + 2;
    },

    processVisualElement(type, content, currentY, isReal, align = {}) {
        const parts = content.split('|');
        
        const id = parts[0] ? parts[0].trim() : '';
        const mode = parseInt(parts[1]) || 0;
        const xOffset = parseInt(parts[2]) || 0;
        const yOffset = parseInt(parts[3]) || 0;
        const rotation = parseInt(parts[4]) || 0;
        const scale = parseFloat(parts[5]) || 1.0;

        const normalizedType = type.toUpperCase();
        const storageId = (normalizedType === 'QR') ? `qr_${id}` : ((normalizedType === 'CODE128') ? `code128_${id}` : id);
        const imgObj = ImageManager.storage ? ImageManager.storage[storageId] : null;

        if (!imgObj) {
            this.ensureResourceLoaded(normalizedType, id, storageId);
            return mode === 0 ? (normalizedType === 'CODE128' ? 70 : 175) : 0;
        }

        let w = imgObj.width * scale;
        let h = imgObj.height * scale;

        // Kağıt sınırlarını aşmayı önlemek için sığdır
        const canvasWidth = this.canvasWidth || 384;
        const maxPrintWidth = canvasWidth - 10;
        let fitFactor = 1.0;
        if (w > maxPrintWidth) {
            fitFactor = Math.min(fitFactor, maxPrintWidth / w);
        }
        if (this.orientation === 'landscape' && (h * fitFactor) > 364) {
            fitFactor = Math.min(fitFactor, 364 / h);
        }
        w = w * fitFactor;
        h = h * fitFactor;

        let centerX, centerY;

        if (mode === 1) {
            // Kağıt dışına ve negatif koordinatlara taşmayı engelle (en az 5px kenar payı)
            const safeX = Math.max(5, Math.min(canvasWidth - w - 5, xOffset));
            const safeY = Math.max(5, yOffset);
            centerX = safeX + w / 2;
            centerY = safeY + h / 2;
        } else {
            if (align && align.hasRight) {
                centerX = canvasWidth - 5 - w / 2 + xOffset;
            } else {
                centerX = (canvasWidth / 2) + xOffset; 
            }
            centerY = currentY + h / 2 + yOffset;
        }

        this._maxVisualY = Math.max(this._maxVisualY || 0, centerY + h / 2 + 10);

        if (isReal) {
            this.ctx.save();
            this.ctx.imageSmoothingEnabled = false; 
            
            this.ctx.translate(centerX, centerY);
            this.ctx.rotate(rotation * Math.PI / 180);

            this.ctx.drawImage(imgObj, -w / 2, -h / 2, w, h);

            if (typeof App !== 'undefined' && storageId === App.selectedId) {
                this.drawSelectionOverlay(w, h);
            }

            this.ctx.restore();
        }

        this.lastRenderedPositions[storageId] = {
            x: centerX - w / 2,
            y: centerY - h / 2,
            w: w,
            h: h,
            mode: mode,
            r: rotation,
            s: scale
        };

        return mode === 0 ? (h + 10) : 0;
    },

    drawSelectionOverlay(w, h) {
        this.ctx.strokeStyle = '#0078d7';
        this.ctx.lineWidth = 2;
        this.ctx.setLineDash([5, 5]);
        
        this.ctx.strokeRect(-w / 2 - 2, -h / 2 - 2, w + 4, h + 4);
        
        this.ctx.fillStyle = '#0078d7';
        this.ctx.setLineDash([]);
        const handleSize = 6;
        this.ctx.fillRect(w / 2 - handleSize / 2, h / 2 - handleSize / 2, handleSize, handleSize);
    },

    
 async renderMarkdown(text, params) {
        // Mobil ve masaüstünde fontların tam yüklendiğinden emin olalım
        if (document.fonts) {
            await document.fonts.ready;
        }

        this.lastRenderedPositions = {};
        const { fontSize, lineSpacing, offsetX, fontFamily, bottomMargin, orientation, landscapeWidth } = params;
        
        this.orientation = orientation || 'portrait';
        const CANVAS_WIDTH = (this.orientation === 'landscape') 
            ? Math.max(384, Math.min(1200, parseInt(landscapeWidth) || 576)) 
            : 384;
        this.canvasWidth = CANVAS_WIDTH;

        this.style = { 
            fontSize, 
            lineSpacing, 
            offsetX: offsetX || 0, 
            fontFamily: fontFamily || 'Arial', 
            currentSize: fontSize,
            bottomMargin: bottomMargin !== undefined ? parseInt(bottomMargin) : (this.orientation === 'landscape' ? 15 : 25)
        };
        
        const lines = text.split('\n');
        const PADDING_X = 5;

        const drawLoop = (isReal) => {
            let currentY = (isReal && this.orientation === 'landscape' && this._calculatedTotalH && this._calculatedTotalH < 350)
                ? Math.max(5, Math.floor((384 - this._calculatedTotalH) / 2))
                : 5;
            let boxStartY = null;
            let currentBoxType = 'solid';
            this._maxVisualY = 0;

            if (isReal) {
                this.ctx.imageSmoothingEnabled = false;
                this.ctx.textBaseline = "top";
                this.ctx.fillStyle = "black";
            }

            lines.forEach(line => {
                let cleanLine = line.trim();
                
                if (cleanLine === '') { 
                    currentY += this.style.fontSize * 0.8; 
                    return; 
                }

                const hasCenter = /\[C\]/i.test(cleanLine);
                const hasRight = /\[R\]/i.test(cleanLine);
                const cleanTagLine = cleanLine.replace(/\[C\]|\[R\]/gi, '').trim();
                const tagMatch = cleanTagLine.match(/^\[(IMG|QR|CODE128):(.+?)\]$/i);
                if (tagMatch) {
                    currentY += this.processVisualElement(tagMatch[1].toUpperCase(), tagMatch[2], currentY, isReal, { hasCenter, hasRight });
                    return;
                }

                if (cleanLine.startsWith('|') && cleanLine.endsWith('|')) {
                    currentY += this.drawTable(cleanLine, currentY, isReal);
                    return;
                }

                // Ayraç çizgileri: '---', '===', '~~~', '...' veya tekrarlayan uzun çizgiler (örn: ====================)
                if (/^([-=~.])\1{2,}$/.test(cleanLine)) {
                    const lineType = cleanLine[0] === '-' ? '---' :
                                     cleanLine[0] === '=' ? '===' :
                                     cleanLine[0] === '~' ? '~~~' : '...';
                    if (isReal) this.drawLine(lineType, currentY);
                    currentY += 15; 
                    return;
                }

                if (/^\[BOX/i.test(cleanLine)) {
                    boxStartY = currentY;
                    currentBoxType = /:dots/i.test(cleanLine) ? 'dots' : 'solid';
                    currentY += 10;
                    return;
                }
                if (/\[\/BOX\]/i.test(cleanLine)) {
                    if (isReal && boxStartY !== null) {
                        this.ctx.save();
                        this.ctx.lineWidth = 2;
                        this.ctx.strokeStyle = 'black';
                        if (currentBoxType === 'dots') this.ctx.setLineDash([5, 5]);
                        this.ctx.strokeRect(2, boxStartY, CANVAS_WIDTH - 4, currentY - boxStartY);
                        this.ctx.restore();
                    }
                    boxStartY = null; 
                    currentY += 10;
                    return;
                }

                let sizeMult = 1, isBold = false, indent = 0, bullet = null;
                
                if (cleanLine.startsWith('# ')) { sizeMult = 1.6; isBold = true; cleanLine = cleanLine.substring(2); }
                else if (cleanLine.startsWith('## ')) { sizeMult = 1.3; isBold = true; cleanLine = cleanLine.substring(3); }
                else if (cleanLine.startsWith('### ')) { sizeMult = 1.15; isBold = true; cleanLine = cleanLine.substring(4); }
                else if (cleanLine.startsWith('* ') || cleanLine.startsWith('- ')) { 
                    bullet = '•'; 
                    indent = 20; 
                    cleanLine = cleanLine.substring(2); 
                } else {
                    const numMatch = cleanLine.match(/^(\d+)\.\s+/);
                    if (numMatch) {
                        bullet = numMatch[1] + '.';
                        indent = 22;
                        cleanLine = cleanLine.substring(numMatch[0].length);
                    }
                }

                let sizeMatch = cleanLine.match(/\[S:(\d+)\]/i);
                let weightMatch = cleanLine.match(/\[W:(\d+)\]/i);
                let isCentered = /\[C\]/i.test(cleanLine);
                let isRight = /\[R\]/i.test(cleanLine);
                let isMonospace = /\[M\]/i.test(cleanLine);

                let lineSize = sizeMatch ? parseInt(sizeMatch[1]) : this.style.fontSize;
                let fontWeight = weightMatch ? weightMatch[1] : (isBold ? '900' : '600');
                
                cleanLine = cleanLine.replace(/\[S:\d+\]/gi, '')
                                     .replace(/\[W:\d+\]/gi, '')
                                     .replace(/\[C\]|\[R\]|\[M\]/gi, '')
                                     .trim();

                const finalSize = lineSize * sizeMult;
                const fontStack = isMonospace 
                    ? 'Consolas, "Courier New", monospace' 
                    : `${this.style.fontFamily}, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`;
                
                this.ctx.font = `${fontWeight} ${finalSize}px ${fontStack}`;

                const maxWidth = CANVAS_WIDTH - (this.style.offsetX + indent + (boxStartY ? 20 : 10));
                const wrappedLines = this.wrapText(cleanLine, maxWidth);

                wrappedLines.forEach(wLine => {
                    let xPos = this.style.offsetX + indent + PADDING_X;
                    if (boxStartY !== null) xPos += 8;

                    const measureTxt = wLine.replace(/\*\*|\*|_/g, '');
                    const textWidth = this.ctx.measureText(measureTxt).width;

                    if (isCentered) xPos = (CANVAS_WIDTH - textWidth) / 2;
                    else if (isRight) xPos = CANVAS_WIDTH - textWidth - PADDING_X - (boxStartY ? 10 : 0);

                    if (isReal) {
                        this.renderStyledText(
                            wLine, 
                            Math.round(xPos), 
                            Math.round(currentY), 
                            finalSize, 
                            fontStack, 
                            true, 
                            bullet, 
                            fontWeight
                        );
                    }
                    
                    bullet = null; 
                    currentY += finalSize * this.style.lineSpacing;
                });
            });
            return Math.max(currentY, this._maxVisualY || 0);
        };

        if (!this.canvas) return;

        this.canvas.width = CANVAS_WIDTH;
        
        // Pas 1: Yükseklik hesapla
        this._calculatedTotalH = 0;
        const totalH = drawLoop(false);
        this._calculatedTotalH = totalH;

        const bMargin = this.style.bottomMargin !== undefined ? this.style.bottomMargin : 25;
        const neededH = Math.ceil(totalH + bMargin);
        this.contentHeight = neededH;
        
        if (this.orientation === 'landscape') {
            // Yatay modda termal rulo genişliği 384 dot'tur.
            this.isOverflowing = (neededH > 384);
            this.canvas.height = Math.max(384, neededH);
        } else {
            this.isOverflowing = false;
            this.canvas.height = Math.max(100, neededH);
        }

        // Pas 2: Çizim yap
        this.ctx.save();
        this.ctx.fillStyle = "white";
        this.ctx.fillRect(0, 0, CANVAS_WIDTH, this.canvas.height);

        drawLoop(true);

        // Yatay modda 384px sınırını aşan durumlarda önizlemede rulo sınır çizgisini göster
        if (this.orientation === 'landscape' && this.isOverflowing) {
            this.ctx.save();
            this.ctx.strokeStyle = '#e63946';
            this.ctx.lineWidth = 1.5;
            this.ctx.setLineDash([5, 5]);
            this.ctx.beginPath();
            this.ctx.moveTo(4, 384);
            this.ctx.lineTo(CANVAS_WIDTH - 4, 384);
            this.ctx.stroke();
            this.ctx.font = 'bold 11px sans-serif';
            this.ctx.fillStyle = '#e63946';
            this.ctx.fillText('✂ 384px Rulo Sınırı (Kâğıda Sığdırılacaktır)', 8, 380);
            this.ctx.restore();
        }

        this.ctx.restore();
    },

    wrapText(text, maxWidth) {
        if (!text || text.trim() === '') return [];
        const words = text.split(' ');
        const lines = [];
        let currentLine = '';

        for (let i = 0; i < words.length; i++) {
            const word = words[i];
            
            // Eğer tek bir kelime maxWidth'ten genişse (örn: uzun takip kodu, URL), harf harf böl
            const wordMeasure = this.ctx.measureText(word.replace(/\*\*|\*|_/g, '')).width;
            if (wordMeasure > maxWidth) {
                if (currentLine) {
                    lines.push(currentLine);
                    currentLine = '';
                }
                let charChunk = '';
                for (let ch of word) {
                    const testChunk = charChunk + ch;
                    if (this.ctx.measureText(testChunk.replace(/\*\*|\*|_/g, '')).width <= maxWidth) {
                        charChunk = testChunk;
                    } else {
                        lines.push(charChunk);
                        charChunk = ch;
                    }
                }
                if (charChunk) currentLine = charChunk;
                continue;
            }

            const testLine = currentLine ? (currentLine + " " + word) : word;
            const measureLine = testLine.replace(/\*\*|\*|_/g, '');
            const width = this.ctx.measureText(measureLine).width;
            
            if (width <= maxWidth) {
                currentLine = testLine;
            } else {
                if (currentLine) lines.push(currentLine);
                currentLine = word;
            }
        }
        if (currentLine) lines.push(currentLine);
        return lines;
    },

    renderStyledText(text, x, y, size, font, isReal, bullet, baseWeight) {
        let currentX = x;
        let i = 0;
        let chunk = "";
        
        let activeStyles = { 
            bold: baseWeight === 'bold' || parseInt(baseWeight) >= 700, 
            italic: false 
        };

        const flush = () => {
            if (chunk === "") return;
            
            const finalWeight = activeStyles.bold ? '900' : baseWeight;
            this.ctx.font = `${activeStyles.italic ? 'italic ' : ''}${finalWeight} ${size}px ${font}`;
            
            if (isReal) {
                if (currentX === x && bullet) {
                    this.ctx.fillText(bullet, x - 15, y);
                }
                
                if (activeStyles.bold) {
                    // Kalın metin için net termal doygunluk
                    this.ctx.fillText(chunk, currentX - 0.2, y);
                    this.ctx.fillText(chunk, currentX + 0.2, y);
                    if (size > 24) {
                        this.ctx.fillText(chunk, currentX, y + 0.2);
                    }
                } else {
                    // Normal metin için tek geçişli, pürüzsüz ve keskin çizim
                    this.ctx.fillText(chunk, currentX, y);
                }
            }
            
            currentX += this.ctx.measureText(chunk).width;
            chunk = "";
        };

        while (i < text.length) {
            if (text.startsWith('**', i)) {
                flush();
                activeStyles.bold = !activeStyles.bold;
                i += 2;
            } else if (text.startsWith('*', i)) {
                flush();
                activeStyles.italic = !activeStyles.italic;
                i += 1;
            } else if (text.startsWith('_', i)) {
                const isMarkdownUnderscore = (i === 0 || text[i-1] === ' ') || (i === text.length - 1 || text[i+1] === ' ');
                if (isMarkdownUnderscore) {
                    flush();
                    activeStyles.italic = !activeStyles.italic;
                    i += 1;
                } else {
                    chunk += '_';
                    i += 1;
                }
            } else {
                chunk += text[i];
                i++;
            }
        }
        flush();
    },
    getBitmapBytes(rotationAngle = 0) {
        const angle = parseInt(rotationAngle) || 0;
        let sourceCanvas = this.canvas;

        // 90, 180 veya 270 derece döndürme işlemi
        if (angle !== 0) {
            const tempCanvas = document.createElement('canvas');
            const tempCtx = tempCanvas.getContext('2d');

            if (angle === 90 || angle === 270) {
                // Yatay modda döndürme:
                // Termal kafa sabit genişliği kesinlikle 384 dot (48 bayt) olmak zorundadır!
                const targetWidth = 384;
                
                // Eğer orijinal canvas yüksekliği 384'ten büyükse, termal kafa genişliğine sığdırmak için orantılı ölçekle
                const scale = (this.canvas.height > targetWidth) ? (targetWidth / this.canvas.height) : 1.0;
                const scaledHeight = Math.round(this.canvas.height * scale);
                const scaledWidth = Math.round(this.canvas.width * scale);

                tempCanvas.width = targetWidth;
                tempCanvas.height = Math.max(1, scaledWidth);

                tempCtx.save();
                tempCtx.fillStyle = "white";
                tempCtx.fillRect(0, 0, tempCanvas.width, tempCanvas.height);

                // Dikeyde ortalama payı (eğer yükseklik < 384 ise kenarlarda simetrik beyaz boşluk kalır)
                const offsetAcross = Math.max(0, Math.floor((targetWidth - scaledHeight) / 2));

                if (angle === 90) {
                    // Saat yönünde 90° döndürme (sol kenar ilk önce yazıcıdan çıkar)
                    tempCtx.translate(targetWidth - offsetAcross, 0);
                    tempCtx.rotate(90 * Math.PI / 180);
                } else if (angle === 270) {
                    // Saat yönünün tersine 90° döndürme
                    tempCtx.translate(offsetAcross, tempCanvas.height);
                    tempCtx.rotate(270 * Math.PI / 180);
                }

                tempCtx.drawImage(this.canvas, 0, 0, scaledWidth, scaledHeight);
                tempCtx.restore();
                sourceCanvas = tempCanvas;
            } else if (angle === 180) {
                // 180 derece (Ters / Baş Aşağı): Müşteriye doğru anında okunabilir çıktı
                tempCanvas.width = this.canvas.width;
                tempCanvas.height = this.canvas.height;
                tempCtx.save();
                tempCtx.fillStyle = "white";
                tempCtx.fillRect(0, 0, tempCanvas.width, tempCanvas.height);
                tempCtx.translate(tempCanvas.width, tempCanvas.height);
                tempCtx.rotate(180 * Math.PI / 180);
                tempCtx.drawImage(this.canvas, 0, 0);
                tempCtx.restore();
                sourceCanvas = tempCanvas;
            }
        }

        // Güvenlik denetimi: Termal yazıcı kafa genişliği 384 dot olmalıdır.
        // Eğer herhangi bir nedenle kaynak canvas genişliği 384 değilse, tam 384'e ölçekleyip garanti altına alalım
        if (sourceCanvas.width !== 384) {
            const fixedCanvas = document.createElement('canvas');
            const fixedCtx = fixedCanvas.getContext('2d');
            const scale = 384 / sourceCanvas.width;
            fixedCanvas.width = 384;
            fixedCanvas.height = Math.max(1, Math.round(sourceCanvas.height * scale));
            fixedCtx.fillStyle = "white";
            fixedCtx.fillRect(0, 0, fixedCanvas.width, fixedCanvas.height);
            fixedCtx.drawImage(sourceCanvas, 0, 0, fixedCanvas.width, fixedCanvas.height);
            sourceCanvas = fixedCanvas;
        }

        const width = sourceCanvas.width; 
        const height = sourceCanvas.height;
        const ctx = sourceCanvas.getContext('2d');
        
        const imgData = ctx.getImageData(0, 0, width, height).data;

        const bytesPerRow = Math.ceil(width / 8);
        const bytes = new Uint8Array(bytesPerRow * height);
        const gray = new Float32Array(width * height);

        for (let i = 0; i < width * height; i++) {
            const idx = i * 4;
            if (imgData[idx + 3] < 128) {
                gray[i] = 255;
                continue;
            }

            const r = imgData[idx], g = imgData[idx + 1], b = imgData[idx + 2];
            let grayVal = (r * 0.299 + g * 0.587 + b * 0.114);
            
            if (grayVal < 200) {
                grayVal = Math.pow(grayVal / 255, 2.2) * 255; 
            }
            gray[i] = grayVal;
        }

        const threshold = 128; 
        const errorWeight = 0.35;

        for (let y = 0; y < height; y++) {
            const yOffset = y * width;
            const byteRowOffset = y * bytesPerRow;

            for (let x = 0; x < width; x++) {
                const i = yOffset + x;
                const oldPixel = gray[i];
                const newPixel = oldPixel < threshold ? 0 : 255;
                
                const error = (oldPixel - newPixel) * errorWeight;
                
                if (x + 1 < width) gray[i + 1] += error * 0.5;
                if (y + 1 < height) gray[i + width] += error * 0.5;

                if (newPixel === 0) {
                    const byteIdx = byteRowOffset + (x >> 3); 
                    bytes[byteIdx] |= (1 << (x & 7)); 
                }
            }
        }

        return { bytes, height, width };
    }
};