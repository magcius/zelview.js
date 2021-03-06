(function(exports) {
    "use strict";

    var mat4 = glMatrix.mat4;
    
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
            var bankIdx = addr >>> 24;
            var offs = addr & 0x00FFFFFF;
            function findBank(bankIdx) {
                switch (bankIdx) {
                    case 0x02: return banks.scene;
                    case 0x03: return banks.room;
                    default: return null;
                }
            }
            var bank = findBank(bankIdx);
            if (bank === null)
                return null;
            var absOffs = bank.vStart + offs;
            if (absOffs > bank.vEnd)
                return null;
            return absOffs;
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

        function readCollision(collisionAddr) {
            var offs = rom.lookupAddress(banks, collisionAddr);

            function readVerts(N, addr) {
                var offs = rom.lookupAddress(banks, addr);
                var verts = new Uint16Array(N * 3);
                for (var i = 0; i < N; i++) {
                    verts[i*3+0] = rom.view.getInt16(offs + 0x00, false);
                    verts[i*3+1] = rom.view.getInt16(offs + 0x02, false);
                    verts[i*3+2] = rom.view.getInt16(offs + 0x04, false);
                    offs += 0x06;
                }
                return verts;
            }
            var vertsN = rom.view.getUint16(offs + 0x0C, false);
            var vertsAddr = rom.view.getUint32(offs + 0x10, false);
            var verts = readVerts(vertsN, vertsAddr);

            function readPolys(N, addr) {
                var offs = rom.lookupAddress(banks, addr);
                var polys = new Uint16Array(N * 3);
                for (var i = 0; i < N; i++) {
                    polys[i*3+0] = rom.view.getUint16(offs + 0x02, false) & 0x0FFF;
                    polys[i*3+1] = rom.view.getUint16(offs + 0x04, false) & 0x0FFF;
                    polys[i*3+2] = rom.view.getUint16(offs + 0x06, false) & 0x0FFF;
                    offs += 0x10;
                }
                return polys;
            }
            var polysN = rom.view.getUint16(offs + 0x14, false);
            var polysAddr = rom.view.getUint32(offs + 0x18, false);
            var polys = readPolys(polysN, polysAddr);

            function readWaters(N, addr) {
                // XXX: While we should probably keep the actual stuff about
                // water boxes, I'm just drawing them, so let's just record
                // a quad.
                var offs = rom.lookupAddress(banks, addr);
                var waters = new Uint16Array(N * 3 * 4);

                for (var i = 0; i < N; i++) {
                    var x = rom.view.getInt16(offs + 0x00, false);
                    var y = rom.view.getInt16(offs + 0x02, false);
                    var z = rom.view.getInt16(offs + 0x04, false);
                    var sx = rom.view.getInt16(offs + 0x06, false);
                    var sz = rom.view.getInt16(offs + 0x08, false);
                    waters[i*3*4+0] = x;
                    waters[i*3*4+1] = y;
                    waters[i*3*4+2] = z;
                    waters[i*3*4+3] = x + sx;
                    waters[i*3*4+4] = y;
                    waters[i*3*4+5] = z;
                    waters[i*3*4+6] = x;
                    waters[i*3*4+7] = y;
                    waters[i*3*4+8] = z + sz;
                    waters[i*3*4+9] = x + sx;
                    waters[i*3*4+10] = y;
                    waters[i*3*4+11] = z + sz;
                    offs += 0x10;
                }
                return waters;
            }

            var watersN = rom.view.getUint16(offs + 0x24, false);
            var watersAddr = rom.view.getUint32(offs + 0x28, false);
            var waters = readWaters(watersN, watersAddr);

            function readCamera(addr) {
                var skyboxCamera = loadAddress(addr + 0x04);
                var offs = rom.lookupAddress(banks, skyboxCamera);
                var x = rom.view.getInt16(offs + 0x00, false);
                var y = rom.view.getInt16(offs + 0x02, false);
                var z = rom.view.getInt16(offs + 0x04, false);
                var a = rom.view.getUint16(offs + 0x06, false) / 0xFFFF * (Math.PI * 2);
                var b = rom.view.getUint16(offs + 0x08, false) / 0xFFFF * (Math.PI * 2) + Math.PI;
                var c = rom.view.getUint16(offs + 0x0A, false) / 0xFFFF * (Math.PI * 2);
                var d = rom.view.getUint16(offs + 0x0C, false);

                var mtx = mat4.create();
                mat4.translate(mtx, mtx, [x, y, z]);
                mat4.rotateZ(mtx, mtx, c);
                mat4.rotateY(mtx, mtx, b);
                mat4.rotateX(mtx, mtx, -a);
                return mtx;
            }

            var cameraAddr = rom.view.getUint32(offs + 0x20, false);
            var camera = readCamera(cameraAddr);

            return { verts: verts, polys: polys, waters: waters, camera: camera };
        }

        function readRoom(file) {
            var banks2 = Object.create(banks);
            banks2.room = file;
            return readHeaders(gl, rom, file.vStart, banks2);
        }

        function readRooms(nRooms, roomTableAddr) {
            var rooms = [];
            for (var i = 0; i < nRooms; i++) {
                var pStart = loadAddress(roomTableAddr);
                var file = rom.lookupFile(pStart);
                rooms.push(readRoom(file));
                roomTableAddr += 8;
            }
            return rooms;
        }

        function loadImage(gl, src) {
            var canvas = document.createElement('canvas');
            var ctx = canvas.getContext('2d');

            var texId = gl.createTexture();
            gl.bindTexture(gl.TEXTURE_2D, texId);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

            var img = document.createElement('img');
            img.src = src;
            var textures = document.querySelector('#textures');
            textures.appendChild(img);

            var aspect = 1;

            img.onload = function() {
                canvas.width = img.width;
                canvas.height = img.height;
                ctx.drawImage(img, 0, 0);

                var imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);

                gl.bindTexture(gl.TEXTURE_2D, texId);
                gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, imgData.width, imgData.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, imgData.data);
            };

            // XXX: Should pull this dynamically at runtime.
            var imgWidth = 320;
            var imgHeight = 240;

            var imgAspect = imgWidth / imgHeight;
            var viewportAspect = gl.viewportWidth / gl.viewportHeight;

            var x = imgAspect / viewportAspect;

            var vertData = new Float32Array([
                /* x   y   z   u  v */
                  -x, -1,  0,  0, 1,
                   x, -1,  0,  1, 1,
                  -x,  1,  0,  0, 0,
                   x,  1,  0,  1, 0,
            ]);

            var vertBuffer = gl.createBuffer();
            gl.bindBuffer(gl.ARRAY_BUFFER, vertBuffer);
            gl.bufferData(gl.ARRAY_BUFFER, vertData, gl.STATIC_DRAW);

            var idxData = new Uint8Array([
                0, 1, 2, 3,
            ]);

            var idxBuffer = gl.createBuffer();
            gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, idxBuffer);
            gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, idxData, gl.STATIC_DRAW);

            // 3 pos + 2 uv
            var VERTEX_SIZE = 5;
            var VERTEX_BYTES = VERTEX_SIZE * Float32Array.BYTES_PER_ELEMENT;

            return function(gl) {
                var prog = gl.currentProgram;
                gl.disable(gl.BLEND);
                gl.disable(gl.DEPTH_TEST);
                gl.bindBuffer(gl.ARRAY_BUFFER, vertBuffer);
                gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, idxBuffer);
                gl.vertexAttribPointer(prog.positionLocation, 3, gl.FLOAT, false, VERTEX_BYTES, 0);
                gl.vertexAttribPointer(prog.uvLocation, 2, gl.FLOAT, false, VERTEX_BYTES, 3 * Float32Array.BYTES_PER_ELEMENT);
                gl.enableVertexAttribArray(prog.positionLocation);
                gl.enableVertexAttribArray(prog.uvLocation);
                gl.bindTexture(gl.TEXTURE_2D, texId);
                gl.drawElements(gl.TRIANGLE_STRIP, 4, gl.UNSIGNED_BYTE, 0);
                gl.disableVertexAttribArray(prog.positionLocation);
                gl.disableVertexAttribArray(prog.uvLocation);
            };
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
                // The last entry always seems to contain the BG. Not sure
                // what the other data is about... maybe the VR skybox for rotating scenes?
                var lastEntry = nEntries - 1;
                var bg = loadAddress(meshAddr + (lastEntry * 0x0C) + 0x08);
                var bgOffs = rom.lookupAddress(banks, bg);
                var buffer = rom.view.buffer.slice(bgOffs);
                var blob = new Blob([buffer], { type: 'image/jpeg' });
                var url = window.URL.createObjectURL(blob);
                mesh.bg = loadImage(gl, url);
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
                case HeaderCommands.Collision:
                    if (headers.collision) XXX;
                    headers.collision = readCollision(cmd2);
                    break;
                case HeaderCommands.Rooms:
                    var nRooms = (cmd1 >> 16) & 0xFF;
                    headers.rooms = readRooms(nRooms, cmd2);
                    break;
                case HeaderCommands.Mesh:
                    if (headers.mesh) XXX;
                    headers.mesh = readMesh(cmd2);
                    break;
            }
        }
        return headers;
    }

    function readScene(gl, zelview0, file) {
        var banks = { scene: file };
        return readHeaders(gl, zelview0, file.vStart, banks);
    }

})(window);
