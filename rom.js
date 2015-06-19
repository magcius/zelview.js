(function(exports) {
    "use strict";

    function read0String(buffer, offs, length) {
        var buf = new Uint8Array(buffer, offs, length);
        var L = new Array(length);
        for (var i = 0; i < length; i++) {
            var elem = buf[i];
            if (elem == 0)
                break;
            L.push(String.fromCharCode(elem));
        }
        return L.join('');
    }

    function readDMATable(view, offs) {
        var dmaTable = [];

        function readDMAEntry() {
            var entry = {};
            entry.vStart = view.getUint32(offs, false);
            entry.vEnd = view.getUint32(offs + 0x4, false);
            entry.pStart = view.getUint32(offs + 0x8, false);
            entry.pEnd = view.getUint32(offs + 0xC, false);

            entry.valid = true;
            if (entry.pStart == 0xFFFFFFFF || entry.pEnd == 0xFFFFFFFF)
                entry.valid = false;

            // Convenience for us -- uncompressed files leave pEnd as blank.
            entry.size = entry.vEnd - entry.vStart;
            if (entry.pEnd == 0)
                entry.pEnd = entry.pStart + entry.size;

            offs += 0x10;
            return entry;
        }

        while (true) {
            var entry = readDMAEntry();
            if (entry.vStart == 0 && entry.vEnd == 0 && entry.pStart == 0)
                break;
            dmaTable.push(entry);
        }

        return dmaTable;
    }

    function readFileTable(view, offs, dmaTable) {
        dmaTable.forEach(function(entry) {
            if (!entry.valid)
                return;

            entry.filename = read0String(view.buffer, offs, 64);
            offs += entry.filename.length + 1;
            offs = (offs + 3) & ~3;

            if (entry.filename.endsWith("_scene"))
                entry.fileType = "scene";
            else if (entry.filename.indexOf("_room_") >= 0)
                entry.fileType = "room";
            else if (entry.filename.startsWith("ovl_"))
                entry.fileType = "overlay";
            else if (entry.filename.startsWith("object_"))
                entry.fileType = "object";
        });
    }

    function findCode(dmaTable) {
        for (var i = 0; i < dmaTable.length; i++) {
            var entry = dmaTable[i];
            if (entry.filename == "code")
                return entry;
        }
    }

    function findFile(dmaTable, file) {
        for (var i = 0; i < dmaTable.length; i++) {
            var entry = dmaTable[i];
            if (entry.pStart == file.pStart && entry.pEnd == file.pEnd)
                return entry;
        }
    }

    var SCENES = {
        "Inside the Deku Tree": 0x01FC2000,
        "Dodongo's Cavern": 0x0203A000,
        "Inside Jabu-Jabu's Belly": 0x020E0000,
        "Forest Temple": 0x02149000,
        "Fire Temple": 0x02213000,
        "Water Temple": 0x0230B000,
        "Spirit Temple": 0x023DC000,
        "Shadow Temple": 0x024EA000,
        "Bottom of the Well": 0x0258E000,
        "Ice Cavern": 0x025CC000,
        "Ganon's Castle Tower": 0x03130000,
        "Gerudo Training Grounds": 0x02635000,
        "Thieves' Hideout": 0x0340B000,
        "Ganon's Castle": 0x026A4000,
        "Ganon's Castle Tower (Crumbling)": 0x03505000,
        "Ganon's Castle (Crumbling)": 0x0358C000,
        "Treasure Chest Contest": 0x034E1000,
        "Inside the Deku Tree (Boss)": 0x03101000,
        "Dodongo's Cavern (Boss)": 0x030F5000,
        "Inside Jabu-Jabu's Belly (Boss)": 0x02EFD000,
        "Forest Temple (Boss)": 0x02C74000,
        "Fire Temple (Boss)": 0x02F08000,
        "Water Temple (Boss)": 0x0311D000,
        "Spirit Temple (Mid-Boss)": 0x031A4000,
        "Shadow Temple (Boss)": 0x03111000,
        "Second-To-Last Boss Ganondorf": 0x03196000,
        "Ganondorf, Death Scene": 0x03234000,
        "Market Entrance (Day)": 0x02C4D000,
        "Market Entrance (Night)": 0x02D9D000,
        "Market Entrance (Adult)": 0x02DC4000,
        "Back Alley (Day)": 0x02D07000,
        "Back Alley (Night)": 0x02DEB000,
        "Market (Day)": 0x02AE4000,
        "Market (Night)": 0x02AED000,
        "Market (Adult)": 0x02D98000,
        "Temple of Time (Outside, Day)": 0x032DD000,
        "Temple of Time (Outside, Night)": 0x0334C000,
        "Temple of Time (Outside, Adult)": 0x033A1000,
        "Know-it-all Brothers": 0x02BBC000,
        "House of Twins": 0x02E68000,
        "Mido's House": 0x031C6000,
        "Saria's House": 0x03201000,
        "Kakariko Village House": 0x02ED1000,
        "Back Alley Village House": 0x03254000,
        "Kakariko Bazaar": 0x02C9F000,
        "Kokiri Shop": 0x02B8A000,
        "Goron Shop": 0x02F7F000,
        "Zora Shop": 0x02FA7000,
        "Kakariko Potion Shop": 0x02FCF000,
        "Market Potion Shop": 0x02FFC000,
        "Bombchu Shop": 0x03024000,
        "Happy Mask Shop": 0x0354B000,
        "Link's House": 0x02B60000,
        "Puppy Woman's House": 0x0304E000,
        "Stables": 0x02EA1000,
        "Impa's House": 0x03076000,
        "Lakeside Laboratory": 0x0347F000,
        "Carpenter's Tent": 0x030A4000,
        "Dampé's Hut": 0x02F19000,
        "Great Fairy Fountain": 0x02F44000,
        "Small Fairy Fountain": 0x02F5F000,
        "Magic Fairy Fountain": 0x02F6D000,
        "Grottos": 0x02BE9000,
        "Grave (1)": 0x02F56000,
        "Grave (2)": 0x033F6000,
        "Royal Family's Tomb": 0x03463000,
        "Shooting Gallery": 0x02C8A000,
        "Temple of Time Inside": 0x02B24000,
        "Chamber of Sages": 0x02B0C000,
        "Castle Courtyard (Day)": 0x02CCA000,
        "Castle Courtyard (Night)": 0x0343F000,
        "Cutscene Map": 0x02E63000,
        "Dampé's Grave &amp; Kakariko Windmill": 0x0329B000,
        "Fishing Pond": 0x03332000,
        "Zelda's Courtyard": 0x030D9000,
        "Bombchu Bowling Alley": 0x0344D000,
        "Talon's House": 0x03499000,
        "Lots'o Pots": 0x034BE000,
        "Granny's Potion Shop": 0x034CF000,
        "Final Battle against Ganon": 0x03535000,
        "Skulltula House": 0x0357B000,
        "Hyrule Field": 0x027D6000,
        "Kakariko Village": 0x02817000,
        "Kakariko Graveyard": 0x0283E000,
        "Zora's River": 0x0286B000,
        "Kokiri Forest": 0x0288D000,
        "Sacred Forest Meadow": 0x028CA000,
        "Lake Hylia": 0x028E9000,
        "Zora's Domain": 0x02910000,
        "Zora's Fountain": 0x0292E000,
        "Gerudo Valley": 0x02949000,
        "Lost Woods": 0x02964000,
        "Desert Colossus": 0x029A4000,
        "Gerudo's Fortress": 0x029CB000,
        "Haunted Wasteland": 0x029FA000,
        "Hyrule Castle": 0x02A14000,
        "Death Mountain": 0x02A3B000,
        "Death Mountain Crater": 0x02A65000,
        "Goron City": 0x02A8F000,
        "Lon Lon Ranch": 0x02D7F000,
        "Ganon's Tower (Outside)": 0x02CE7000,
        "Collision Testing Area": 0x035B3000,
        "Besitu / Treasure Chest Warp": 0x03544000,
        "Depth Test": 0x027AF000,
        "Stalfos Middle Room": 0x02793000,
        "Stalfos Boss Room": 0x027A2000,
        "Dark Link Testing Area": 0x02B57000,
        "Beta Castle Courtyard": 0x03280000,
        "Action Testing Room": 0x02D00000,
        "Item Testing Room": 0x02AF6000,
    };

    function readSceneTable(rom) {
        // Find the first scene, and then look around for it in the code segment.
        function getFirstScene() {
            var bestEntry = null;
            for (var i = 0; i < rom.dmaTable.length; i++) {
                var entry = rom.dmaTable[i];
                if (entry.fileType == "scene" && (!bestEntry || entry.vStart < bestEntry.vStart))
                    bestEntry = entry;
            }
            return bestEntry;
        }

        function findSceneTable() {
            var firstScene = getFirstScene();
            var search = rom.codeEntry.pEnd - 40;
            while (search > 0) {
                var sceneStart = rom.view.getUint32(search, false);
                var sceneEnd = rom.view.getUint32(search + 4, false);
                if (sceneStart == firstScene.pStart && sceneEnd == firstScene.pEnd)
                    return search;
                search -= 4;
            }
        }

        var sceneTable = [];
        var offs = findSceneTable();

        function readSceneEntry() {
            var scene = {};
            scene.pStart = rom.view.getUint32(offs, false);
            scene.pEnd = rom.view.getUint32(offs + 4, false);
            return scene;
        }

        while (offs < rom.codeEntry.pEnd) {
            var scene = readSceneEntry();
            sceneTable.push(scene);
            offs += 20;

            scene.dmaEntry = findFile(rom.dmaTable, scene);
            if (!scene.dmaEntry)
                break;
            scene.filename = scene.dmaEntry.filename;
        }

        return sceneTable;
    }

    var HeaderCommands = {
        Spawns: 0x00,
        Actors: 0x01,
        Camera: 0x02,
        Collision: 0x03,
        Rooms: 0x04,
        WindSettings: 0x05,
        EntranceList: 0x06,
        SpecialObjects: 0x07,
        SpecialBehavior: 0x08,
        // 0x09 is unknown
        Mesh: 0x0A,
        Objects: 0x0B,
        // 0x0C is unused
        Waypoints: 0x0D,
        Transitions: 0x0E,
        Environment: 0x0F,
        Time: 0x10,
        Skybox: 0x11,
        End: 0x14,
    };

    function readHeaders(rom, offs, banks) {
        var headers = {};

        function loadAddress(addr) {
            return rom.loadAddress(banks, addr);
        }

        function readRoom(offs) {
            var banks2 = Object.create(banks);
            banks2.room = offs;
            return readHeaders(rom, offs, banks2);
        }

        function readRooms(nRooms, roomTableAddr) {
            var rooms = [];
            for (var i = 0; i < nRooms; i++) {
                var start = loadAddress(roomTableAddr);
                var end = loadAddress(roomTableAddr + 4);
                console.log(start.toString(16));
                var room = { pStart: start, pEnd: end };
                room.dmaEntry = findFile(rom.dmaTable, room);
                rooms.push(room);
                // rooms.push(readRoom(loadAddress(roomTableAddr)));
                roomTableAddr += 8;
            }
            return rooms;
        }

        function readMesh(meshAddr) {
            var hdr = loadAddress(meshAddr);
            var type = (hdr >> 24);
            var nEntries = (hdr >> 16) & 0xFF;
            var entriesAddr = loadAddress(meshAddr + 4);

            var mesh = {};
            mesh.opaque = [];
            mesh.transparent = [];

            function readDL(addr) {
                var dlStart = loadAddress(addr);
                if (dlStart === 0)
                    return null;

                return F3DEX2.readDL(rom.gl, rom, banks, dlStart);
            }

            if (type == 0) {
                for (var i = 0; i < nEntries; i++) {
                    mesh.opaque.push(readDL(entriesAddr));
                    mesh.transparent.push(readDL(entriesAddr + 4));
                    entriesAddr += 8;
                }
            } else if (type == 1) {
            } else if (type == 2) {
                for (var i = 0; i < nEntries; i++) {
                    mesh.opaque.push(readDL(entriesAddr + 8));
                    mesh.transparent.push(readDL(entriesAddr + 12));
                    entriesAddr += 16;
                }
            }

            mesh.opaque = mesh.opaque.filter(function(dl) { return !!dl; });
            mesh.transparent = mesh.transparent.filter(function(dl) { return !!dl; });

            return mesh;
        }

        headers.rooms = [];
        headers.mesh = null;

        var startOffs = offs;

        while (true) {
            var cmd1 = rom.view.getUint32(offs, false);
            var cmd2 = rom.view.getUint32(offs + 4, false);
            offs += 8;

            var cmdType = cmd1 >> 24;

            if (cmdType == HeaderCommands.End)
                break;

            switch (cmdType) {
                case HeaderCommands.Rooms:
                    var nRooms = (cmd1 >> 16) & 0xFF;
                    var roomTableAddr = cmd2;
                    headers.rooms = headers.rooms.concat(readRooms(nRooms, roomTableAddr));
                    break;
                /*
                case HeaderCommands.Mesh:
                    if (headers.mesh) XXX;
                    var meshAddr = cmd2;
                    headers.mesh = readMesh(meshAddr);
                    break;
                */
            }
        }
        return headers;
    }

    function readScene(rom, offs) {
        return readHeaders(rom, offs, { scene: offs });
    }

    function downloadBlob(filename, blob) {
        var url = window.URL.createObjectURL(blob);
        var elem = document.createElement('a');
        elem.setAttribute('href', url);
        elem.setAttribute('download', filename);
        document.body.appendChild(elem);
        elem.click();
        document.body.removeChild(elem);
    }

    function buildVFS(rom, files, mainFile) {
        var MAGIC = "ZELVIEW0";
        var HEADER_SIZE = 0x8 + 0x8;

        function writeString(view, offs, S, L) {
            var N = Math.min(S.length, L);
            for (var i = 0; i < N; i++)
                view.setUint8(offs++, S.charCodeAt(i));
            return L;
        }

        function buildVFS() {
            var VFS_ENTRY_SIZE = 0x30 + 0x10;
            var buffer = new ArrayBuffer(HEADER_SIZE + VFS_ENTRY_SIZE * files.length);
            var view = new DataView(buffer);

            var offs = 0;
            offs += writeString(view, 0, MAGIC, 0x8);
            view.setUint32(offs, files.length, true);
            offs += 0x04;
            view.setUint32(offs, mainFile, true);
            offs += 0x04;

            var dataOffs = buffer.byteLength;
            for (var i = 0; i < files.length; i++) {
                var file = files[i];
                offs += writeString(view, offs, file.filename, 0x30);
                view.setUint32(offs, file.pStart, true);
                view.setUint32(offs + 0x04, file.pEnd, true);
                view.setUint32(offs + 0x08, dataOffs, true);
                dataOffs += file.size;
                view.setUint32(offs + 0x0C, dataOffs, true);
                offs += 0x10;
            }

            return buffer;
        }
        function readDMAEntry(file) {
            console.log(file.pStart, file.size);
            return rom.view.buffer.slice(file.pStart, file.pEnd);
        }

        var vfsBuffer = buildVFS();
        var blobParts = [vfsBuffer];
        for (var i = 0; i < files.length; i++) {
            blobParts.push(readDMAEntry(files[i]));
        }

        console.log(blobParts);
        var blob = new Blob(blobParts, { type: 'application/octet-stream' });
        return blob;
    }

    function buildSceneVFS(rom, sceneEntry) {
        function gatherFiles() {
            var files = [sceneEntry.dmaEntry];
            var scene = readScene(rom, sceneEntry.pStart);
            files = files.concat(scene.rooms.map(function(r) { return r.dmaEntry; }));
            return files;
        }

        var files = gatherFiles();
        var blob = buildVFS(rom, files);
        var filename = sceneEntry.filename + '.zelview0';
        // downloadBlob(filename, blob);
    }

    function parseROM(gl, buffer) {
        var rom = {};
        window.rom = rom;
        var view = new DataView(buffer);
        rom.view = view;
        rom.lookupAddress = function(banks, addr) {
            var bank = addr >>> 24;
            var offs = addr & 0x00FFFFFF;
            switch (bank) {
                case 0x02: return banks.scene + offs;
                case 0x03: return banks.room + offs;
                default: return null;
            }
        };
        rom.loadAddress = function(banks, addr) {
            var offs = rom.lookupAddress(banks, addr);
            return rom.view.getUint32(offs)
        };

        rom.title = read0String(buffer, 0x20, 0x14);
        rom.gameID = read0String(buffer, 0x3B, 0x4);
        rom.version = view.getUint8(0x3F);

        rom.creator = read0String(buffer, 0x12F40, 0x10);
        rom.buildDate = read0String(buffer, 0x12F50, 0x20);

        rom.dmaTable = readDMATable(view, 0x12F70);
        readFileTable(view, 0xBE80, rom.dmaTable);

        rom.codeEntry = findCode(rom.dmaTable);
        console.log(rom.codeEntry);

        rom.sceneTable = readSceneTable(rom, 0x10CBB0);
        buildSceneVFS(rom, rom.sceneTable[0]);

        /*
        rom.readScene = function(startAddr) {
            return readScene(rom, startAddr);
        };
        */

        rom.SCENES = SCENES;
        rom.gl = gl;

        return rom;
    }
    exports.parseROM = parseROM;

})(window);
