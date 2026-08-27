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
                margin: 1,
                color: { dark: "#000000", light: "#ffffff" },
                errorCorrectionLevel: 'H'
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
        const endX = 379;
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

        const CANVAS_WIDTH = 384;
        const PADDING = 4;
        const colWidth = (CANVAS_WIDTH - 10) / columns.length;

        if (isReal) {
            this.ctx.save();
            this.ctx.font = `600 ${this.style.fontSize}px ${this.style.fontFamily}`;
            this.ctx.imageSmoothingEnabled = false;

            columns.forEach((col, index) => {
                const x = 5 + (index * colWidth);
                
                let text = col;
                const maxWidth = colWidth - (PADDING * 2);
                while (this.ctx.measureText(text).width > maxWidth && text.length > 0) {
                    text = text.substring(0, text.length - 1);
                }

                this.ctx.fillText(text, x + PADDING - 0.15, currentY);
                this.ctx.fillText(text, x + PADDING + 0.15, currentY);
                
                if (index > 0) {
                    this.ctx.beginPath();
                    this.ctx.setLineDash([2, 2]);
                    this.ctx.moveTo(x, currentY - 2);
                    this.ctx.lineTo(x, currentY + (this.style.fontSize * this.style.lineSpacing));
                    this.ctx.strokeStyle = '#666';
                    this.ctx.stroke();
                }
            });
            this.ctx.restore();
        }

        return this.style.fontSize * this.style.lineSpacing;
    },

    processVisualElement(type, content, currentY, isReal) {
        const parts = content.split('|');
        
        const id = parts[0] ? parts[0].trim() : '';
        const mode = parseInt(parts[1]) || 0;
        const xOffset = parseInt(parts[2]) || 0;
        const yOffset = parseInt(parts[3]) || 0;
        const rotation = parseInt(parts[4]) || 0;
        const scale = parseFloat(parts[5]) || 1.0;

        const storageId = (type === 'QR') ? `qr_${id}` : ((type === 'CODE128') ? `code128_${id}` : id);
        const imgObj = ImageManager.storage ? ImageManager.storage[storageId] : null;

        if (!imgObj) {
            this.ensureResourceLoaded(type, id, storageId);
            return mode === 0 ? (type === 'CODE128' ? 70 : 175) : 0;
        }

        const w = imgObj.width * scale;
        const h = imgObj.height * scale;

        let centerX, centerY;

        if (mode === 1) {
            centerX = xOffset + w / 2;
            centerY = yOffset + h / 2;
        } else {
            centerX = (384 / 2) + xOffset; 
            centerY = currentY + h / 2 + yOffset;
        }

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
        const { fontSize, lineSpacing, offsetX, fontFamily } = params;
        
        this.style = { 
            fontSize, 
            lineSpacing, 
            offsetX: offsetX || 0, 
            fontFamily: fontFamily || 'Arial', 
            currentSize: fontSize 
        };
        
        const lines = text.split('\n');
        const CANVAS_WIDTH = 384;
        const PADDING_X = 5;

        const drawLoop = (isReal) => {
            let currentY = 5;
            let boxStartY = null;
            let currentBoxType = 'solid';

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

                const tagMatch = cleanLine.match(/^\[(IMG|QR|CODE128):(.+?)\]$/);
                if (tagMatch) {
                    currentY += this.processVisualElement(tagMatch[1], tagMatch[2], currentY, isReal);
                    return;
                }

                if (cleanLine.startsWith('|') && cleanLine.endsWith('|')) {
                    currentY += this.drawTable(cleanLine, currentY, isReal);
                    return;
                }

                if (['---', '===', '~~~', '...'].includes(cleanLine)) {
                    if (isReal) this.drawLine(cleanLine, currentY);
                    currentY += 15; 
                    return;
                }

                if (cleanLine.startsWith('[BOX')) {
                    boxStartY = currentY;
                    currentBoxType = cleanLine.includes(':dots') ? 'dots' : 'solid';
                    currentY += 10;
                    return;
                }
                if (cleanLine.includes('[/BOX]')) {
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
                else if (cleanLine.startsWith('* ')) { bullet = '•'; indent = 20; cleanLine = cleanLine.substring(2); }

                let sizeMatch = cleanLine.match(/\[S:(\d+)\]/);
                let weightMatch = cleanLine.match(/\[W:(\d+)\]/);
                let isCentered = cleanLine.includes('[C]');
                let isRight = cleanLine.includes('[R]');
                let isMonospace = cleanLine.includes('[M]');

                let lineSize = sizeMatch ? parseInt(sizeMatch[1]) : this.style.fontSize;
                let fontWeight = weightMatch ? weightMatch[1] : (isBold ? '900' : '600');
                
                cleanLine = cleanLine.replace(/\[S:\d+\]/g, '')
                                     .replace(/\[W:\d+\]/g, '')
                                     .replace(/\[C\]|\[R\]|\[M\]/g, '')
                                     .trim();

                const finalSize = lineSize * sizeMult;
                const fontStack = isMonospace 
                    ? 'Consolas, "Courier New", monospace' 
                    : `"${this.style.fontFamily}", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`;
                
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
            return currentY;
        };

        if (!this.canvas) return;

        this.canvas.width = 384;
        
        // Pas 1: Yükseklik hesapla
        const totalH = drawLoop(false);
        this.canvas.height = Math.max(100, Math.ceil(totalH + 20));

        // Pas 2: Çizim yap
        this.ctx.save();
        this.ctx.fillStyle = "white";
        this.ctx.fillRect(0, 0, CANVAS_WIDTH, this.canvas.height);

        drawLoop(true);
        this.ctx.restore();
    },

    wrapText(text, maxWidth) {
        const words = text.split(' ');
        if (words.length === 0 || text.trim() === '') return [];

        const lines = [];
        let currentLine = words[0];

        for (let i = 1; i < words.length; i++) {
            const word = words[i];
            const testLine = currentLine + " " + word;
            const measureLine = testLine.replace(/\*\*|\*|_/g, '');
            const width = this.ctx.measureText(measureLine).width;
            
            if (width < maxWidth) {
                currentLine = testLine;
            } else {
                lines.push(currentLine);
                currentLine = word;
            }
        }
        lines.push(currentLine);
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
                
                this.ctx.fillText(chunk, currentX - 0.15, y);
                this.ctx.fillText(chunk, currentX + 0.15, y);
                
                if (size > 24) {
                    this.ctx.fillText(chunk, currentX, y + 0.15);
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
                i += 1; 
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

        // Eğer 90, 180 veya 270 derece döndürme isteniyorsa geçici bir Canvas üzerinde çevirelim
        if (angle !== 0) {
            const tempCanvas = document.createElement('canvas');
            const tempCtx = tempCanvas.getContext('2d');

            if (angle === 90 || angle === 270) {
                // Yatay modda genişlik ve yükseklik yer değiştirir
                tempCanvas.width = this.canvas.height;
                tempCanvas.height = this.canvas.width;
            } else {
                // 180 derecede boyutlar aynı kalır
                tempCanvas.width = this.canvas.width;
                tempCanvas.height = this.canvas.height;
            }

            tempCtx.save();
            // Canvas merkezine git ve döndür
            if (angle === 90) {
                tempCtx.translate(tempCanvas.width, 0);
                tempCtx.rotate(90 * Math.PI / 180);
            } else if (angle === 180) {
                tempCtx.translate(tempCanvas.width, tempCanvas.height);
                tempCtx.rotate(180 * Math.PI / 180);
            } else if (angle === 270) {
                tempCtx.translate(0, tempCanvas.height);
                tempCtx.rotate(270 * Math.PI / 180);
            }

            // Orijinal canvas'ı döndürülmüş tempCanvas üzerine çiz
            tempCtx.drawImage(this.canvas, 0, 0);
            tempCtx.restore();

            sourceCanvas = tempCanvas;
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