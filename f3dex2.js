(function(exports) {
    "use strict";

    // Zelda uses the F3DEX2 display list format. This implements
    // a simple (and probably wrong!) HLE renderer for it.

    var UCodeCommands = {
        VTX: 0x01,
        TRI1: 0x05,
        TRI2: 0x06,
        GEOMETRYMODE: 0xD9,

        SETOTHERMODE_L: 0xE2,
        SETOTHERMODE_H: 0xE3,

        DL: 0xDE,
        ENDDL: 0xDF,

        MTX: 0xDA,
        POPMTX: 0xD8,

        TEXTURE: 0xD7,
        LOADTLUT: 0xF0,
        LOADBLOCK: 0xF3,
        SETTILESIZE: 0xF2,
        SETTILE: 0xF5,
        SETPRIMCOLOR: 0xF9,
        SETENVCOLOR: 0xFB,
        SETCOMBINE: 0xFC,
        SETTIMG: 0xFD,
        RDPLOADSYNC: 0xE6,
        RDPPIPESYNC: 0xE7,
    };

    var UCodeNames = {};
    for (var name in UCodeCommands)
        UCodeNames[UCodeCommands[name]] = name;

    // 3 pos + 2 uv + 4 color/nrm
    var VERTEX_SIZE = 9;
    var VERTEX_BYTES = VERTEX_SIZE * Float32Array.BYTES_PER_ELEMENT;

    var N = 0;
    function readVertex(state, which, addr) {
        var rom = state.rom;
        var offs = state.lookupAddress(addr);
        var posX = rom.view.getInt16(offs, false);
        var posY = rom.view.getInt16(offs+2, false);
        var posZ = rom.view.getInt16(offs+4, false);

        var pos = vec3.clone([posX, posY, posZ]);
        vec3.transformMat4(pos, pos, state.mtx);

        var txU = rom.view.getInt16(offs+8, false) * (1/32);
        var txV = rom.view.getInt16(offs+10, false) * (1/32);

        var vtxArray = new Float32Array(state.vertexBuffer.buffer, which * VERTEX_BYTES, VERTEX_SIZE);
        vtxArray[0] = pos[0]; vtxArray[1] = pos[1]; vtxArray[2] = pos[2];
        vtxArray[3] = txU; vtxArray[4] = txV;

        vtxArray[5] = rom.view.getUint8(offs + 12) / 255;
        vtxArray[6] = rom.view.getUint8(offs + 13) / 255;
        vtxArray[7] = rom.view.getUint8(offs + 14) / 255;
        vtxArray[8] = rom.view.getUint8(offs + 15) / 255;
    }

    function cmd_VTX(state, w0, w1) {
        var N = (w0 >> 12) & 0xFF;
        var V0 = ((w0 >> 1) & 0x7F) - N;
        var addr = w1;

        for (var i = 0; i < N; i++) {
            var which = V0 + i;
            readVertex(state, which, addr);
            addr += 16;

            state.verticesDirty[which] = true;
        }
    }

    function translateTRI(state, idxData) {
        var gl = state.gl;

        function anyVertsDirty() {
            for (var i = 0; i < idxData.length; i++)
                if (state.verticesDirty[idxData[i]])
                    return true;
            return false;
        }

        function createGLVertBuffer() {
            var vertBuffer = gl.createBuffer();
            gl.bindBuffer(gl.ARRAY_BUFFER, vertBuffer);
            gl.bufferData(gl.ARRAY_BUFFER, state.vertexBuffer, gl.STATIC_DRAW);
            return vertBuffer;
        }
        function getVertexBufferGL() {
            if (anyVertsDirty() || !state.vertexBufferGL) {
                state.vertexBufferGL = createGLVertBuffer();
                state.verticesDirty = [];
            }
            return state.vertexBufferGL;
        }

        var vertBuffer = getVertexBufferGL();
        var idxBuffer = gl.createBuffer();
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, idxBuffer);
        gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, idxData, gl.STATIC_DRAW);

        var nPrim = idxData.length;

        return function drawTri(gl) {
            var prog = gl.currentProgram;
            gl.bindBuffer(gl.ARRAY_BUFFER, vertBuffer);
            gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, idxBuffer);
            gl.vertexAttribPointer(prog.positionLocation, 3, gl.FLOAT, false, VERTEX_BYTES, 0);
            gl.vertexAttribPointer(prog.uvLocation, 2, gl.FLOAT, false, VERTEX_BYTES, 3 * Float32Array.BYTES_PER_ELEMENT);
            gl.vertexAttribPointer(prog.colorLocation, 4, gl.FLOAT, false, VERTEX_BYTES, 5 * Float32Array.BYTES_PER_ELEMENT);
            gl.enableVertexAttribArray(prog.positionLocation);
            gl.enableVertexAttribArray(prog.colorLocation);
            gl.enableVertexAttribArray(prog.uvLocation);
            gl.drawElements(gl.TRIANGLES, nPrim, gl.UNSIGNED_BYTE, 0);
            gl.disableVertexAttribArray(prog.positionLocation);
            gl.disableVertexAttribArray(prog.uvLocation);
            gl.disableVertexAttribArray(prog.colorLocation);
        };
    }

    function tri(idxData, offs, cmd) {
        idxData[offs+0] = (cmd >> 17) & 0x7F;
        idxData[offs+1] = (cmd >> 9) & 0x7F;
        idxData[offs+2] = (cmd >> 1) & 0x7F;
    }

    function flushTexture(state) {
        if (state.textureTile)
            loadTile(state, state.textureTile);
    }

    function cmd_TRI1(state, w0, w1) {
        flushTexture(state);
        var idxData = new Uint8Array(3);
        tri(idxData, 0, w0);
        state.cmds.push(translateTRI(state, idxData));
    }

    function cmd_TRI2(state, w0, w1) {
        flushTexture(state);
        var idxData = new Uint8Array(6);
        tri(idxData, 0, w0); tri(idxData, 3, w1);
        state.cmds.push(translateTRI(state, idxData));
    }

    var GeometryMode = {
        CULL_FRONT: 0x0200,
        CULL_BACK: 0x0400,
        LIGHTING: 0x020000,
    };

    function syncGeometryMode(gl, newMode) {
        var cullFront = newMode & GeometryMode.CULL_FRONT;
        var cullBack = newMode & GeometryMode.CULL_BACK;

        if (cullFront && cullBack)
            gl.cullFace(gl.FRONT_AND_BACK);
        else if (cullFront)
            gl.cullFace(gl.FRONT);
        else if (cullBack)
            gl.cullFace(gl.BACK);

        if (cullFront || cullBack)
            gl.enable(gl.CULL_FACE);
        else
            gl.disable(gl.CULL_FACE);

        var lighting = newMode & GeometryMode.LIGHTING;
        var useVertexColors = !lighting;
        var prog = gl.currentProgram;
        gl.uniform1i(prog.useVertexColorsLocation, useVertexColors);
    }

    function cmd_GEOMETRYMODE(state, w0, w1) {
        state.geometryMode = state.geometryMode & ((~w0) & 0x00FFFFFF) | w1;
        var newMode = state.geometryMode;

        state.cmds.push(function(gl) {
            return syncGeometryMode(gl, newMode);
        });
    }

    var OtherModeL = {
        Z_CMP: 0x0010,
        Z_UPD: 0x0020,
        ZMODE_DEC: 0x0C00,
        CVG_X_ALPHA: 0x1000,
        ALPHA_CVG_SEL: 0x2000,
        FORCE_BL: 0x4000,
    };

    function syncRenderMode(gl, newMode) {
        if (newMode & OtherModeL.Z_CMP)
            gl.enable(gl.DEPTH_TEST);
        else
            gl.disable(gl.DEPTH_TEST);

        if (newMode & OtherModeL.Z_UPD)
            gl.depthMask(true);
        else
            gl.depthMask(false);

        var prog = gl.currentProgram;
        var alphaTestMode;

        if (newMode & OtherModeL.FORCE_BL) {
            alphaTestMode = 0;
            gl.enable(gl.BLEND);
            // XXX: additional blend funcs?
            gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
        } else {
            alphaTestMode = ((newMode & OtherModeL.CVG_X_ALPHA) ? 0x1 : 0 |
                             (newMode & OtherModeL.ALPHA_CVG_SEL) ? 0x2 : 0);
            gl.disable(gl.BLEND);
        }

        if (newMode & OtherModeL.ZMODE_DEC) {
            gl.enable(gl.POLYGON_OFFSET_FILL);
            gl.polygonOffset(-0.5, -0.5);
        } else {
            gl.disable(gl.POLYGON_OFFSET_FILL);
        }

        gl.uniform1i(prog.alphaTestLocation, alphaTestMode);
    }

    function cmd_SETOTHERMODE_L(state, w0, w1) {
        state.cmds.push(function(gl) {
            var mode = 31 - (w0 & 0xFF);
            if (mode == 3)
                return syncRenderMode(gl, w1);
        })
    }

    function cmd_DL(state, w0, w1) {
        runDL(state, w1);
    }

    function cmd_MTX(state, w0, w1) {
        if (w1 & 0x80000000) state.mtx = state.mtxStack.pop();
        w1 &= ~0x80000000;

        state.geometryMode = 0;
        state.otherModeL = 0;

        state.mtxStack.push(state.mtx);
        state.mtx = mat4.clone(state.mtx);

        var rom = state.rom;
        var offs = state.lookupAddress(w1);

        var mtx = mat4.create();

        for (var x = 0; x < 4; x++) {
            for (var y = 0; y < 4; y++) {
                var mt1 = rom.view.getUint16(offs, false);
                var mt2 = rom.view.getUint16(offs + 32, false);
                mtx[(x * 4) + y] = ((mt1 << 16) | (mt2)) * (1 / 0x10000);
            }
        }

        mat4.multiply(state.mtx, state.mtx, mtx);
    }

    function cmd_POPMTX(state, w0, w1) {
        state.mtx = state.mtxStack.pop();
    }

    function cmd_TEXTURE(state, w0, w1) {
        var boundTexture = {};
        state.boundTexture = boundTexture;

        var s = w1 >> 16;
        var t = w1 & 0x0000FFFF;

        state.boundTexture.scaleS = (s+1) / 0x10000;
        state.boundTexture.scaleT = (t+1) / 0x10000;
    }

    function r5g5b5a1(dst, dstOffs, p) {
        var r, g, b, a;

        r = (p & 0xF800) >> 11;
        r = (r << (8-5)) | (r >> (10-8));

        g = (p & 0x07C0) >> 6;
        g = (g << (8-5)) | (g >> (10-8));

        b = (p & 0x003E) >> 1;
        b = (b << (8-5)) | (b >> (10-8));

        a = (p & 0x0001) ? 0xFF : 0x00;

        dst[dstOffs + 0] = r;
        dst[dstOffs + 1] = g;
        dst[dstOffs + 2] = b;
        dst[dstOffs + 3] = a;
    }

    function cmd_SETTIMG(state, w0, w1) {
        state.textureImage = {};
        state.textureImage.format = (w0 >> 21) & 0x7;
        state.textureImage.size = (w0 >> 19) & 0x3;
        state.textureImage.width = (w0 & 0x1000) + 1;
        state.textureImage.addr = w1;
    }

    function cmd_SETTILE(state, w0, w1) {
        state.tile = {};
        var tile = state.tile;

        tile.format = (w0 >> 16) & 0xFF;
        tile.cms = (w1 >> 8) & 0x3;
        tile.cmt = (w1 >> 18) & 0x3;
        tile.tmem = w0 & 0x1FF;
        tile.lineSize = (w0 >> 9) & 0x1FF;
        tile.palette = (w1 >> 20) & 0xF;
        tile.shiftS = w1 & 0xF;
        tile.shiftT = (w1 >> 10) & 0xF;
        tile.maskS = (w1 >> 4) & 0xF;
        tile.maskT = (w1 >> 14) & 0xF;
    }

    function cmd_SETTILESIZE(state, w0, w1) {
        var tileIdx = (w1 >> 24) & 0x7;
        var tile = state.tile;

        tile.uls = (w0 >> 14) & 0x3FF;
        tile.ult = (w0 >> 2) & 0x3FF;
        tile.lrs = (w1 >> 14) & 0x3FF;
        tile.lrt = (w1 >> 2) & 0x3FF;
    }

    function cmd_LOADTLUT(state, w0, w1) {
        var srcOffs = state.lookupAddress(state.textureImage.addr);
        var rom = state.rom;

        // XXX: properly implement uls/ult/lrs/lrt
        var size = ((w1 & 0x00FFF000) >> 14) + 1;
        var dst = new Uint8Array(size * 4);
        var dstOffs = 0;

        for (var i = 0; i < size; i++) {
            var pixel = rom.view.getUint16(srcOffs, false);
            r5g5b5a1(dst, dstOffs, pixel);
            srcOffs += 2;
            dstOffs += 4;
        }

        state.paletteTile = state.tile;
        state.paletteTile.pixels = dst;
    }

    function tileCacheKey(tile) {
        // XXX: Do we need more than this?
        return tile.addr;
    }

    // XXX: This is global to cut down on resources between DLs.
    var tileCache = {};
    function loadTile(state, tile) {
        if (tile.textureId)
            return;

        var key = tileCacheKey(tile);
        var otherTile = tileCache[key];
        if (!otherTile) {
            translateTexture(state, tile);
            tileCache[key] = tile;
        } else if (tile !== otherTile) {
            tile.textureId = otherTile.textureId;
            tile.width = otherTile.width;
            tile.height = otherTile.height;
            tile.wrapS = otherTile.wrapS;
            tile.wrapT = otherTile.wrapT;
        }
    }

    function textureToCanvas(texture) {
        var canvas = document.createElement("canvas");
        canvas.width = texture.width;
        canvas.height = texture.height;

        var ctx = canvas.getContext("2d");
        var imgData = ctx.createImageData(canvas.width, canvas.height);

        if (texture.dstFormat == "i8") {
            for (var si = 0, di = 0; di < imgData.data.length; si++, di += 4) {
                imgData.data[di+0] = texture.pixels[si];
                imgData.data[di+1] = texture.pixels[si];
                imgData.data[di+2] = texture.pixels[si];
                imgData.data[di+3] = 255;
            }
        } else if (texture.dstFormat == "i8_a8") {
            for (var si = 0, di = 0; di < imgData.data.length; si += 2, di += 4) {
                imgData.data[di+0] = texture.pixels[si];
                imgData.data[di+1] = texture.pixels[si];
                imgData.data[di+2] = texture.pixels[si];
                imgData.data[di+3] = texture.pixels[si + 1];
            }
        } else if (texture.dstFormat == "rgba8") {
            for (var i = 0; i < imgData.data.length; i++)
                imgData.data[i] = texture.pixels[i];
        }

        canvas.title = '0x' + texture.addr.toString(16) + '  ' + texture.format.toString(16) + '  ' + texture.dstFormat;
        ctx.putImageData(imgData, 0, 0);
        var textures = document.querySelector('#textures');
        textures.appendChild(canvas);
        return canvas;
    }

    function convert_CI4(state, texture) {
        var srcOffs = state.lookupAddress(texture.addr);
        var nBytes = texture.width * texture.height * 4;
        var dst = new Uint8Array(nBytes);
        var i = 0;
        var palette = state.paletteTile.pixels;
        if (!palette)
            return;

        for (var y = 0; y < texture.height; y++) {
            for (var x = 0; x < texture.width; x += 2) {
                var b, idx;
                b = state.rom.view.getUint8(srcOffs++);

                idx = ((b & 0xF0) >> 4) * 4;
                dst[i++] = palette[idx++];
                dst[i++] = palette[idx++];
                dst[i++] = palette[idx++];
                dst[i++] = palette[idx++];

                idx = (b & 0x0F) * 4;
                dst[i++] = palette[idx++];
                dst[i++] = palette[idx++];
                dst[i++] = palette[idx++];
                dst[i++] = palette[idx++];
            }
        }

        texture.pixels = dst;
    }

    function convert_I4(state, texture) {
        var srcOffs = state.lookupAddress(texture.addr);
        var nBytes = texture.width * texture.height;
        var dst = new Uint8Array(nBytes);
        var i = 0;

        for (var y = 0; y < texture.height; y++) {
            for (var x = 0; x < texture.width; x += 2) {
                var b, p;
                b = state.rom.view.getUint8(srcOffs++);

                p = (b & 0xF0) >> 4;
                p = p << 4 | p;
                dst[i++] = p;

                p = (b & 0x0F);
                p = p << 4 | p;
                dst[i++] = p;
            }
        }

        texture.pixels = dst;
    }

    function convert_IA4(state, texture) {
        var srcOffs = state.lookupAddress(texture.addr);
        var nBytes = texture.width * texture.height * 2;
        var dst = new Uint8Array(nBytes);
        var i = 0;

        for (var y = 0; y < texture.height; y++) {
            for (var x = 0; x < texture.width; x += 2) {
                var b, p, pm;
                b = state.rom.view.getUint8(srcOffs++);

                p = (b & 0xF0) >> 4;
                pm = p & 0x0E;
                dst[i++] = (pm << 4 | pm);
                dst[i++] = (p & 0x01) ? 0xFF : 0x00;

                p = (b & 0x0F);
                pm = p & 0x0E;
                dst[i++] = (pm << 4 | pm);
                dst[i++] = (p & 0x01) ? 0xFF : 0x00;
            }
        }

        texture.pixels = dst;
    }

    function convert_CI8(state, texture) {
        var srcOffs = state.lookupAddress(texture.addr);
        var nBytes = texture.width * texture.height * 4;
        var dst = new Uint8Array(nBytes);
        var i = 0;
        var palette = state.paletteTile.pixels;
        if (!palette)
            return;

        for (var y = 0; y < texture.height; y++) {
            for (var x = 0; x < texture.width; x++) {
                var idx = state.rom.view.getUint8(srcOffs)*4;
                dst[i++] = palette[idx++];
                dst[i++] = palette[idx++];
                dst[i++] = palette[idx++];
                dst[i++] = palette[idx++];
                srcOffs++;
            }
        }

        texture.pixels = dst;
    }

    function convert_I8(state, texture) {
        var srcOffs = state.lookupAddress(texture.addr);
        var nBytes = texture.width * texture.height;
        var dst = new Uint8Array(nBytes);
        var i = 0;

        for (var y = 0; y < texture.height; y++) {
            for (var x = 0; x < texture.width; x++)
                dst[i++] = state.rom.view.getUint8(srcOffs++);
        }

        texture.pixels = dst;
    }

    function convert_IA8(state, texture) {
        var srcOffs = state.lookupAddress(texture.addr);
        var nBytes = texture.width * texture.height * 2;
        var dst = new Uint8Array(nBytes);
        var i = 0;

        for (var y = 0; y < texture.height; y++) {
            for (var x = 0; x < texture.width; x++) {
                var p, b;
                b = state.rom.view.getUint8(srcOffs++);

                p = (b & 0xF0) >> 4;
                p = p << 4 | p;
                dst[i++] = p;

                p = (b & 0x0F);
                p = p >> 4 | p;
                dst[i++] = p;
            }
        }

        texture.pixels = dst;
    }

    function convert_RGBA16(state, texture) {
        var rom = state.rom;
        var srcOffs = state.lookupAddress(texture.addr);
        var nBytes = texture.width * texture.height * 4;
        var dst = new Uint8Array(nBytes);
        var i = 0;

        for (var y = 0; y < texture.height; y++) {
            for (var x = 0; x < texture.width; x++) {
                var pixel = rom.view.getUint16(srcOffs, false);
                r5g5b5a1(dst, i, pixel);
                i += 4;
                srcOffs += 2;
            }
        }

        texture.pixels = dst;
    }

    function convert_IA16(state, texture) {
        var srcOffs = state.lookupAddress(texture.addr);
        var nBytes = texture.width * texture.height * 2;
        var dst = new Uint8Array(nBytes);
        var i = 0;

        for (var y = 0; y < texture.height; y++) {
            for (var x = 0; x < texture.width; x++) {
                dst[i++] = state.rom.view.getUint8(srcOffs++);
                dst[i++] = state.rom.view.getUint8(srcOffs++);
            }
        }

        texture.pixels = dst;
    }

    function translateTexture(state, texture) {
        var gl = state.gl;

        calcTextureSize(texture);

        function convertTexturePixels() {
            switch (texture.format) {
                // 4-bit
                case 0x40: return convert_CI4(state, texture);    // CI
                case 0x60: return convert_IA4(state, texture);    // IA
                case 0x80: return convert_I4(state, texture);     // I
                // 8-bit
                case 0x48: return convert_CI8(state, texture);    // CI
                case 0x68: return convert_IA8(state, texture);    // IA
                case 0x88: return convert_I8(state, texture);     // I
                // 16-bit
                case 0x10: return convert_RGBA16(state, texture); // RGBA
                case 0x70: return convert_IA16(state, texture);   // IA
                default: console.error("Unsupported texture", texture.format.toString(16));
            }
        }

        texture.dstFormat = calcTextureDestFormat(texture);

        convertTexturePixels();
        if (!texture.pixels) {
            if (texture.dstFormat == "i8")
                texture.pixels = new Uint8Array(texture.width * texture.height);
            else if (texture.dstFormat == "i8_a8")
                texture.pixels = new Uint8Array(texture.width * texture.height * 2);
            else if (texture.dstFormat == "rgba8")
                texture.pixels = new Uint8Array(texture.width * texture.height * 4);
        }

        function translateWrap(cm) {
            switch (cm) {
                case 1: return gl.MIRRORED_REPEAT;
                case 2: return gl.CLAMP_TO_EDGE;
                case 3: return gl.CLAMP_TO_EDGE;
                default: return gl.REPEAT;
            }
        }

        texture.wrapT = translateWrap(texture.cmt);
        texture.wrapS = translateWrap(texture.cms);

        var texId = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, texId);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

        var glFormat;
        if (texture.dstFormat == "i8")
            glFormat = gl.LUMINANCE;
        else if (texture.dstFormat == "i8_a8")
            glFormat = gl.LUMINANCE_ALPHA;
        else if (texture.dstFormat == "rgba8")
            glFormat = gl.RGBA;

        textureToCanvas(texture);

        gl.texImage2D(gl.TEXTURE_2D, 0, glFormat, texture.width, texture.height, 0, glFormat, gl.UNSIGNED_BYTE, texture.pixels);
        texture.textureId = texId;
    }

    function calcTextureDestFormat(texture) {
        switch (texture.format & 0xE0) {
            case 0x00: return "rgba8"; // RGBA
            case 0x40: return "rgba8"; // CI -- XXX -- do we need to check the palette type?
            case 0x60: return "i8_a8"; // IA
            case 0x80: return "i8";    // I
            default: XXX;
        }
    }

    function calcTextureSize(texture) {
        var maxTexel, lineShift;
        switch (texture.format) {
            // 4-bit
            case 0x00: maxTexel = 4096; lineShift = 4; break; // RGBA
            case 0x40: maxTexel = 4096; lineShift = 4; break; // CI
            case 0x60: maxTexel = 8196; lineShift = 4; break; // IA
            case 0x80: maxTexel = 8196; lineShift = 4; break; // I
            // 8-bit
            case 0x08: maxTexel = 2048; lineShift = 3; break; // RGBA
            case 0x48: maxTexel = 2048; lineShift = 3; break; // CI
            case 0x68: maxTexel = 4096; lineShift = 3; break; // IA
            case 0x88: maxTexel = 4096; lineShift = 3; break; // I
            // 16-bit
            case 0x10: maxTexel = 2048; lineShift = 2; break; // RGBA
            case 0x50: maxTexel = 2048; lineShift = 0; break; // CI
            case 0x70: maxTexel = 2048; lineShift = 2; break; // IA
            case 0x90: maxTexel = 2048; lineShift = 0; break; // I
            // 32-bit
            case 0x18: maxTexel = 1024; lineShift = 2; break; // RGBA
        }

        var lineW = texture.lineSize << lineShift;
        texture.rowStride = lineW;
        var tileW = texture.lrs - texture.uls + 1;
        var tileH = texture.lrt - texture.ult + 1;

        var maskW = 1 << texture.maskS;
        var maskH = 1 << texture.maskT;

        var lineH;
        if (lineW > 0)
            lineH = Math.min(maxTexel / lineW, tileH);
        else
            lineH = 0;

        var width;
        if (texture.maskS > 0 && (maskW * maskH) <= maxTexel)
            width = maskW;
        else if ((tileW * tileH) <= maxTexel)
            width = tileW;
        else
            width = lineW;

        var height;
        if (texture.maskT > 0 && (maskW * maskH) <= maxTexel)
            height = maskH;
        else if ((tileW * tileH) <= maxTexel)
            height = tileH;
        else
            height = lineH;

        texture.width = width;
        texture.height = height;
    }

    var CommandDispatch = {};
    CommandDispatch[UCodeCommands.VTX] = cmd_VTX;
    CommandDispatch[UCodeCommands.TRI1] = cmd_TRI1;
    CommandDispatch[UCodeCommands.TRI2] = cmd_TRI2;
    CommandDispatch[UCodeCommands.GEOMETRYMODE] = cmd_GEOMETRYMODE;
    CommandDispatch[UCodeCommands.DL] = cmd_DL;
    CommandDispatch[UCodeCommands.MTX] = cmd_MTX;
    CommandDispatch[UCodeCommands.POPMTX] = cmd_POPMTX;
    CommandDispatch[UCodeCommands.SETOTHERMODE_L] = cmd_SETOTHERMODE_L;
    CommandDispatch[UCodeCommands.LOADTLUT] = cmd_LOADTLUT;
    CommandDispatch[UCodeCommands.TEXTURE] = cmd_TEXTURE;
    CommandDispatch[UCodeCommands.SETTIMG] = cmd_SETTIMG;
    CommandDispatch[UCodeCommands.SETTILE] = cmd_SETTILE;
    CommandDispatch[UCodeCommands.SETTILESIZE] = cmd_SETTILESIZE;

    var F3DEX2 = {};

    function loadTextureBlock(state, cmds) {
        cmd_SETTIMG(state, cmds[0][0], cmds[0][1]);
        cmd_SETTILE(state, cmds[5][0], cmds[5][1]);
        cmd_SETTILESIZE(state, cmds[6][0], cmds[6][1]);
        var tile = state.tile;
        state.textureTile = tile;
        tile.addr = state.textureImage.addr;
        state.cmds.push(function(gl) {
            if (!tile.textureId)
                return;

            gl.bindTexture(gl.TEXTURE_2D, tile.textureId);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, tile.wrapS);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, tile.wrapT);
            var prog = gl.currentProgram;
            gl.uniform2fv(prog.txsLocation, [1 / tile.width, 1 / tile.height]);
        });
    }

    function runDL(state, addr) {
        function collectNextCmds() {
            var L = [];
            var voffs = offs;
            for (var i = 0; i < 8; i++) {
                var cmd0 = rom.view.getUint32(voffs, false);
                var cmd1 = rom.view.getUint32(voffs + 4, false);
                L.push([cmd0, cmd1]);
                voffs += 8;
            }
            return L;
        }
        function matchesCmdStream(cmds, needle) {
            for (var i = 0; i < needle.length; i++)
                if (cmds[i][0] >>> 24 !== needle[i])
                    return false;
            return true;
        }

        var rom = state.rom;
        var offs = state.lookupAddress(addr);
        if (offs === null)
            return;
        while (true) {
            var cmd0 = rom.view.getUint32(offs, false);
            var cmd1 = rom.view.getUint32(offs + 4, false);

            var cmdType = cmd0 >>> 24;
            if (cmdType == UCodeCommands.ENDDL)
                break;

            // Texture uploads need to be special.
            if (cmdType == UCodeCommands.SETTIMG) {
                var U = UCodeCommands;
                var nextCmds = collectNextCmds();
                if (matchesCmdStream(nextCmds, [U.SETTIMG, U.SETTILE, U.RDPLOADSYNC, U.LOADBLOCK, U.RDPPIPESYNC, U.SETTILE, U.SETTILESIZE])) {
                    loadTextureBlock(state, nextCmds);
                    offs += 7 * 8;
                    continue;
                }
            }

            var func = CommandDispatch[cmdType];
            if (func) func(state, cmd0, cmd1);
            offs += 8;
        }
    }

    function readDL(gl, rom, banks, startAddr) {
        var state = {};

        state.gl = gl;
        state.cmds = [];

        state.mtx = mat4.create();
        state.mtxStack = [state.mtx];

        state.vertexBuffer = new Float32Array(32 * VERTEX_SIZE);
        state.verticesDirty = [];

        state.paletteTile = {};
        state.rom = rom;
        state.lookupAddress = function(addr) {
            return rom.lookupAddress(banks, addr);
        };

        runDL(state, startAddr);
        return state.cmds;
    }
    F3DEX2.readDL = readDL;

    exports.F3DEX2 = F3DEX2;

})(window);
