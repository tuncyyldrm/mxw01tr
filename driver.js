// Реальный драйвер MXW01
// Реальный драйвер MXW01 - Исправленная версия


// 1. Глобальная функция подключения (максимально близко к твоему оригиналу)
class LefuxinDriver {
    constructor() {
        this.device = null;
        this.ctrl = null;
        this.data = null;
    }

    async connect() {
        try {
            console.log("Bağlantı başlatılıyor...");

            // 1. Добавляем твой найденный AE30 в список
            this.device = await navigator.bluetooth.requestDevice({
                acceptAllDevices: true,
                optionalServices: [
'0000ae30-0000-1000-8000-00805f9b34fb', // Твоя новая ревизия
    '0000ae00-0000-1000-8000-00805f9b34fb', // Классический Lefuxin
    '0000ff00-0000-1000-8000-00805f9b34fb', // Старые модели
    '000018f0-0000-1000-8000-00805f9b34fb', // Альтернативный стек
    '49535343-fe7d-4ae5-8fa9-9fafd205e455', // Broadcom/китайские модули
    '0000fee7-0000-1000-8000-00805f9b34fb'  // AirSync/WeChat протокол
                ]
            });

            const server = await this.device.gatt.connect();
            
            // Даем Windows время "осознать" подключение
            await new Promise(r => setTimeout(r, 600));

            const services = await server.getPrimaryServices();
            
            this.ctrl = null;
            this.data = null;

            // 2. Ищем характеристики AE01 и AE03 внутри всех доступных сервисов
            for (let service of services) {
                try {
                    console.log("Hizmet anketi:", service.uuid);
                    const c = await service.getCharacteristic('0000ae01-0000-1000-8000-00805f9b34fb');
                    const d = await service.getCharacteristic('0000ae03-0000-1000-8000-00805f9b34fb');
                    
                    if (c && d) {
                        this.ctrl = c;
                        this.data = d;
                        console.log("✅ Serviste bulunan portlar:", service.uuid);
                        return this.device.name || "MXW01 Yazıcı";
                    }
                } catch (e) {
                    continue; 
                }
            }

            throw new Error("AE30 servis ünitesi bulundu, ancak içindeki AE01/AE03 kontrol kanalları eksik.");

        } catch (error) {
            console.error("Sürücü hatası:", error);
            throw error;
        }
    }

    _crc(d) {
        let c = 0; 
        for (let b of d) {
            c ^= b; 
            for (let i = 0; i < 8; i++) c = (c & 0x80) ? ((c << 1) ^ 0x07) & 0xFF : (c << 1) & 0xFF;
        } 
        return c;
    }

    async print(bytes, h) {
        if (!this.ctrl || !this.data) throw new Error("Yazıcıya bağlantı yok.");
        
        const send = async (id, p) => {
            const d = new Uint8Array(p);
            const pkt = new Uint8Array([0x22, 0x21, id, 0x00, d.length & 0xFF, (d.length >> 8) & 0xFF, ...d, this._crc(d), 0xFF]);
            await this.ctrl.writeValueWithoutResponse(pkt);
            await new Promise(r => setTimeout(r, 50));
        };

        await send(0xB1, [0x00]); 
        await send(0xA9, [h & 0xFF, (h >> 8) & 0xFF, 48, 0]);
        
        for (let i = 0; i < bytes.length; i += 20) {
            await this.data.writeValueWithoutResponse(bytes.slice(i, i + 20));
            if (i % 400 === 0) await new Promise(r => setTimeout(r, 20));
        }
        await send(0xAD, [0x00]);
    }
}

class ESCPOSDriver {
    constructor() {
        this.device = null;
        this.txChar = null;
        this.rxChar = null;
        this.printerService = null;
    }

    async connect() {
        try {
            console.log("ESC/POS özellikli yazıcı arıyorum...");
            
            this.device = await navigator.bluetooth.requestDevice({
                acceptAllDevices: true,
                optionalServices: [
                    '000018f0-0000-1000-8000-00805f9b34fb',  // XPrinter
                    '49535343-fe7d-4ae5-8fa9-9fafd205e455',  // Nordic/Adafruit
                    'e7810a71-73ae-499d-8c15-faa9aef0c3f2',  // Sunmi
                    '00001101-0000-1000-8000-00805f9b34fb',  // SPP
                    '00001800-0000-1000-8000-00805f9b34fb'   // Generic Access
                ]
            });

            const server = await this.device.gatt.connect();
            
            // Попробуем разные сервисы для ESC/POS принтеров
            const services = await server.getPrimaryServices();
            
            for (let service of services) {
                try {
                    console.log("Hizmeti kontrol etme:", service.uuid);
                    
                    // Вариант 1: Стандартный SPP
                    if (service.uuid === '00001101-0000-1000-8000-00805f9b34fb') {
                        const tx = await service.getCharacteristic('00001101-0000-1000-8000-00805f9b34fb');
                        this.txChar = tx;
                        this.printerService = service;
                        break;
                    }
                    
                    // Вариант 2: Custom сервис для ESC/POS
                    const tx = await service.getCharacteristic('49535343-8841-43f4-a8d4-ecbe34729bb3');
                    const rx = await service.getCharacteristic('49535343-1e4d-4bd9-ba61-23c647249616');
                    
                    if (tx) {
                        this.txChar = tx;
                        this.rxChar = rx;
                        this.printerService = service;
                        break;
                    }
                } catch (e) {
                    continue;
                }
            }

            if (!this.txChar) {
                throw new Error("ESC/POS yazıcı için herhangi bir özellik bulunamadı.");
            }

            return this.device.name || "ESC/POS Yazıcı";
            
        } catch (error) {
            console.error("ESC/POS bağlantı hatası:", error);
            throw error;
        }
    }

    async initializePrinter() {
        // Инициализация ESC/POS принтера
        const initCommands = new Uint8Array([
            0x1B, 0x40, // Initialize
            0x1B, 0x4D, 0x00, // Select font A
            0x1B, 0x33, 0x00, // Set line spacing
            0x1D, 0x21, 0x00, // Cancel character size
            0x1B, 0x45, 0x00  // Cancel bold
        ]);
        
        await this.txChar.writeValueWithoutResponse(initCommands);
        await new Promise(r => setTimeout(r, 200));
    }

    async print(bytes, h) {
        if (!this.txChar) throw new Error("Yazıcı bağlı değil.");
        
        await this.initializePrinter();
        
        // Установка плотности печати (если требуется)
        if (h > 0) {
            const densityCmd = new Uint8Array([
                0x1D, 0x28, 0x4B, 0x02, 0x00, 0x30, h & 0xFF, (h >> 8) & 0xFF
            ]);
            await this.txChar.writeValueWithoutResponse(densityCmd);
        }
        
        // Отправка данных по 20 байт (стандартный MTU)
        for (let i = 0; i < bytes.length; i += 20) {
            await this.txChar.writeValueWithoutResponse(bytes.slice(i, Math.min(i + 20, bytes.length)));
            if (i % 100 === 0) await new Promise(r => setTimeout(r, 10));
        }
        
        // Команда завершения печати
        const finishCmd = new Uint8Array([0x1D, 0x56, 0x42, 0x00]); // Cut paper
        await this.txChar.writeValueWithoutResponse(finishCmd);
    }
}

class BLEProtocolDriver {
    constructor() {
        this.device = null;
        this.txChar = null;
        this.rxChar = null;
        this.fragmentSize = 512;
    }

    async connect() {
        try {
            console.log("BLE seri bağlantı noktasına sahip bir yazıcı arıyorum...");
            
            this.device = await navigator.bluetooth.requestDevice({
                filters: [{ namePrefix: 'HMSoft' }, { namePrefix: 'ZH03' }, { namePrefix: 'BLE' }],
                optionalServices: [
                    '0000ff00-0000-1000-8000-00805f9b34fb',  // Serial data
                    '0000ff01-0000-1000-8000-00805f9b34fb',  // Serial control
                    '6e400001-b5a3-f393-e0a9-e50e24dcca9e',  // Nordic UART
                    '0000fee7-0000-1000-8000-00805f9b34fb'   // Apple Continuity
                ]
            });

            const server = await this.device.gatt.connect();
            
            // Проверяем разные сервисы
            try {
                // 1. Попробуем HMSoft/ZH03 сервис
                const service = await server.getPrimaryService('0000ff00-0000-1000-8000-00805f9b34fb');
                this.txChar = await service.getCharacteristic('0000ff02-0000-1000-8000-00805f9b34fb');
                this.rxChar = await service.getCharacteristic('0000ff01-0000-1000-8000-00805f9b34fb');
            } catch (e) {
                // 2. Попробуем Nordic UART
                try {
                    const service = await server.getPrimaryService('6e400001-b5a3-f393-e0a9-e50e24dcca9e');
                    this.txChar = await service.getCharacteristic('6e400002-b5a3-f393-e0a9-e50e24dcca9e');
                    this.rxChar = await service.getCharacteristic('6e400003-b5a3-f393-e0a9-e50e24dcca9e');
                } catch (e2) {
                    throw new Error("Desteklenen BLE Seri servis bulunamadı.");
                }
            }

            // Настройка размера фрагмента
            const mtu = (await server.getPrimaryService('generic_access')).getCharacteristic('gap.device_name');
            this.fragmentSize = 512; // Стандартный MTU для BLE
            
            return this.device.name || "BLE Seri Yazıcı";
            
        } catch (error) {
            console.error("BLE Seri bağlantı hatası:", error);
            throw error;
        }
    }

    async _sendCommand(cmd) {
        if (!this.txChar) throw new Error("Yazıcı bağlı değil.");
        
        // Разбиваем команду на фрагменты
        for (let i = 0; i < cmd.length; i += this.fragmentSize) {
            const fragment = cmd.slice(i, i + this.fragmentSize);
            await this.txChar.writeValueWithoutResponse(fragment);
            await new Promise(r => setTimeout(r, 20)); // Задержка между пакетами
        }
    }

    async print(bytes, h) {
        // Отправка команды инициализации
        const initCmd = new Uint8Array([0x1B, 0x40]);
        await this._sendCommand(initCmd);
        
        // Настройка параметров печати
        if (h > 0) {
            const densityCmd = new Uint8Array([0x1D, 0x76, 0x30, 0x00, h & 0xFF, (h >> 8) & 0xFF]);
            await this._sendCommand(densityCmd);
        }
        
        // Отправка данных
        await this._sendCommand(bytes);
        
        // Команда отрезания бумаги
        const cutCmd = new Uint8Array([0x1D, 0x56, 0x42, 0x00]);
        await this._sendCommand(cutCmd);
    }
}

class UniversalPrinterDriver {
    constructor() {
        this.device = null;
        this.driver = null;
        this.drivers = {
            'lefuxin': new LefuxinDriver(),
            'escpos': new ESCPOSDriver(),
            'bleserial': new BLEProtocolDriver()
        };
    }

    async connect() {
        try {
            console.log("Yazıcıyı otomatik olarak algıla...");
            
            // Запрашиваем все возможные сервисы
            const allServices = [
                // Lefuxin
                '0000ae30-0000-1000-8000-00805f9b34fb',
                '0000ae00-0000-1000-8000-00805f9b34fb',
                // ESC/POS
                '000018f0-0000-1000-8000-00805f9b34fb',
                '49535343-fe7d-4ae5-8fa9-9fafd205e455',
                // BLE Serial
                '0000ff00-0000-1000-8000-00805f9b34fb',
                '6e400001-b5a3-f393-e0a9-e50e24dcca9e'
            ];
            
            this.device = await navigator.bluetooth.requestDevice({
                acceptAllDevices: true,
                optionalServices: allServices
            });

            const server = await this.device.gatt.connect();
            
            // Определяем тип принтера по доступным сервисам
            const services = await server.getPrimaryServices();
            const serviceUUIDs = services.map(s => s.uuid);
            
            console.log("Bulunan hizmetler:", serviceUUIDs);
            
            // Логика определения
            if (serviceUUIDs.includes('0000ae30-0000-1000-8000-00805f9b34fb') ||
                serviceUUIDs.includes('0000ae00-0000-1000-8000-00805f9b34fb')) {
                this.driver = this.drivers.lefuxin;
                console.log("Tanımı: Lefuxin/MXW01");
            } else if (serviceUUIDs.includes('49535343-fe7d-4ae5-8fa9-9fafd205e455') ||
                      serviceUUIDs.includes('000018f0-0000-1000-8000-00805f9b34fb')) {
                this.driver = this.drivers.escpos;
                console.log("Tanımı: ESC/POS");
            } else if (serviceUUIDs.includes('0000ff00-0000-1000-8000-00805f9b34fb') ||
                      serviceUUIDs.includes('6e400001-b5a3-f393-e0a9-e50e24dcca9e')) {
                this.driver = this.drivers.bleserial;
                console.log("Tanımı: BLE Serial");
            } else {
                throw new Error("Yazıcı türü belirtilmemiş.");
            }
            
            // Используем выбранный драйвер
            return await this.driver.connect();
            
        } catch (error) {
            console.error("Genel Sürücü Hatası:", error);
            throw error;
        }
    }

    async print(bytes, h) {
        if (!this.driver) throw new Error("Sürücü başlatılmadı.");
        return await this.driver.print(bytes, h);
    }
}




// ФЕЙКОВЫЙ ДРАЙВЕР ДЛЯ ТЕСТОВ
class FakeDriver {
    async connect() {
        return new Promise((resolve) => {
            setTimeout(() => resolve("Sanal Hata Ayıklama Yazıcısı"), 1000); // Имитируем поиск 1 сек
        });
    }

    async print(bytes, h) {
        console.log(`[FakePrint] Yazdırma işlemi başlatılıyor. Yükseklik: ${h}px, Bayt: ${bytes.length}`);
        for (let i = 0; i <= 100; i += 20) {
            console.log(`[FakePrint] İlerlemek: ${i}%`);
            await new Promise(r => setTimeout(r, 200)); // Имитируем жужжание принтера
        }
        console.log("[FakePrint] Yazdırma işlemi tamamlandı!");
    }
}

// Реестр принтеров
/*const PrinterRegistry = {
    "mxw01": { name: "MXW01 / Lefuxin (Реальный)", driver: new LefuxinDriver() },
    "fake": { name: "Эмулятор (Для тестов)", driver: new FakeDriver() }
};
*/

const PrinterRegistry = {
    "mxw01": { 
        name: "MXW01 / Lefuxin (Gerçek)", 
        driver: new LefuxinDriver() 
    },
    "escpos": { 
        name: "XPrinter/Sunmi/Bixolon (ESC/POS)", 
        driver: new ESCPOSDriver() 
    },
    "bleserial": { 
        name: "HMSoft/ZH03 (BLE Serial)", 
        driver: new BLEProtocolDriver() 
    },
    "universal": { 
        name: "Otomatik algılama (Evrensel)", 
        driver: new UniversalPrinterDriver() 
    },
    "fake": { 
        name: "Öykünme (Testler için)", 
        driver: new FakeDriver() 
    }
};