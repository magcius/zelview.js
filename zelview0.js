(function(exports) {
    "use strict";

    // Loads the ZELVIEW0 format.

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

    function readZELVIEW0(buffer) {
        var view = new DataView(buffer);

        var MAGIC = "ZELVIEW0";
        if (read0String(buffer, 0, MAGIC.length) != MAGIC)
            throw new Error("Invalid ZELVIEW0 file");

        var offs = 0x08;
        var count = view.getUint8(offs, true);
        offs += 0x04;
        var mainFile = view.getUint8(offs, true);
        offs += 0x04;

        function readVFSEntry() {
            var entry = {};
            entry.filename = read0String(buffer, offs, 0x30);
            offs += 0x30;
            entry.pStart = view.getUint32(offs, true);
            entry.pEnd = view.getUint32(offs + 0x04, true);
            entry.vStart = view.getUint32(offs + 0x08, true);
            entry.vEnd = view.getUint32(offs + 0x0C, true);
            offs += 0x10;
            return entry;
        }

        var entries = [];
        for (var i = 0; i < count; i++)
            entries.push(readVFSEntry());

        var zelview0 = {};
        zelview0.entries = entries;
        zelview0.sceneFile = entries[mainFile];
        zelview0.view = view;

        zelview0.lookupFile = function(pStart) {
            for (var i = 0; i < entries.length; i++) {
                var entry = entries[i];
                if (entry.pStart === pStart)
                    return entry;
            }
        };
        zelview0.lookupAddress = function(banks, addr) {
            var bank = addr >>> 24;
            var offs = addr & 0x00FFFFFF;
            switch (bank) {
                case 0x02: return banks.scene + offs;
                case 0x03: return banks.room + offs;
                default: return null;
            }
        };
        zelview0.loadAddress = function(banks, addr) {
            var offs = zelview0.lookupAddress(banks, addr);
            return zelview0.view.getUint32(offs);
        };
        zelview0.loadScene = function(gl, scene) {
            return readScene(gl, zelview0, scene);
        };
        zelview0.loadMainScene = function(gl) {
            return zelview0.loadScene(gl, zelview0.sceneFile);
        };

        return zelview0;
    }
    exports.readZELVIEW0 = readZELVIEW0;

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

    function readHeaders(gl, rom, offs, banks) {
        var headers = {};

        function loadAddress(addr) {
            return rom.loadAddress(banks, addr);
        }

        function readRoom(offs) {
            var banks2 = Object.create(banks);
            banks2.room = offs;
            return readHeaders(gl, rom, offs, banks2);
        }

        function readRooms(nRooms, roomTableAddr) {
            var rooms = [];
            for (var i = 0; i < nRooms; i++) {
                var pStart = loadAddress(roomTableAddr);
                var file = rom.lookupFile(pStart);
                rooms.push(readRoom(file.vStart));
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

                return F3DEX2.readDL(gl, rom, banks, dlStart);
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
                    headers.rooms = readRooms(nRooms, roomTableAddr);
                    break;
                case HeaderCommands.Mesh:
                    if (headers.mesh) XXX;
                    var meshAddr = cmd2;
                    headers.mesh = readMesh(meshAddr);
                    break;
            }
        }
        return headers;
    }

    function readScene(gl, zelview0, file) {
        var offs = file.vStart;
        return readHeaders(gl, zelview0, offs, { scene: offs });
    }

})(window);