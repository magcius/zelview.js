(function(exports) {
    "use strict";

    function fetch(path, responseType) {
        var request = new XMLHttpRequest();
        request.open("GET", path, true);
        request.responseType = (responseType || "arraybuffer");
        request.send();
        return request;
    }

    // A dumb hack to have "multiline strings".
    function M(X) { return X.join('\n'); }

    function compileShader(gl, str, type) {
        var shader = gl.createShader(type);

        gl.shaderSource(shader, str);
        gl.compileShader(shader);

        if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
            console.error(gl.getShaderInfoLog(shader));
            return null;
        }

        return shader;
    }

    var DL_VERT_SHADER_SOURCE = M([
        'uniform mat4 u_modelView;',
        'uniform mat4 u_projection;',
        'attribute vec3 a_position;',
        'attribute vec2 a_uv;',
        'attribute vec4 a_color;',
        'varying vec4 v_color;',
        'varying vec2 v_uv;',
        'uniform vec2 u_txs;',
        '',
        'void main() {',
        '    gl_Position = u_projection * u_modelView * vec4(a_position, 1.0);',
        '    v_color = a_color;',
        '    v_uv = a_uv * u_txs;',
        '}',
    ]);

    var DL_FRAG_SHADER_SOURCE = M([
        'precision mediump float;',
        'varying vec2 v_uv;',
        'varying vec4 v_color;',
        'uniform sampler2D u_texture;',
        'uniform bool u_useVertexColors;',
        'uniform int u_alphaTest;',
        '',
        'void main() {',
        '    gl_FragColor = texture2D(u_texture, v_uv);',
        '    if (u_useVertexColors)',
        '        gl_FragColor *= v_color;',
        '    if (u_alphaTest > 0 && gl_FragColor.a < 0.0125)',
        '        discard;',
        '}',
    ]);

    function createProgram_DL(gl) {
        var vertShader = compileShader(gl, DL_VERT_SHADER_SOURCE, gl.VERTEX_SHADER);
        var fragShader = compileShader(gl, DL_FRAG_SHADER_SOURCE, gl.FRAGMENT_SHADER);
        var prog = gl.createProgram();
        gl.attachShader(prog, vertShader);
        gl.attachShader(prog, fragShader);
        gl.linkProgram(prog);
        prog.modelViewLocation = gl.getUniformLocation(prog, "u_modelView");
        prog.projectionLocation = gl.getUniformLocation(prog, "u_projection");
        prog.txsLocation = gl.getUniformLocation(prog, "u_txs");
        prog.alphaTestLocation = gl.getUniformLocation(prog, "u_alphaTest");
        prog.useVertexColorsLocation = gl.getUniformLocation(prog, "u_useVertexColors");
        prog.positionLocation = gl.getAttribLocation(prog, "a_position");
        prog.colorLocation = gl.getAttribLocation(prog, "a_color");
        prog.uvLocation = gl.getAttribLocation(prog, "a_uv");
        return prog;
    }

    var COLL_VERT_SHADER_SOURCE = M([
        'uniform mat4 u_modelView;',
        'uniform mat4 u_projection;',
        'attribute vec3 a_position;',
        '',
        'void main() {',
        '    gl_Position = u_projection * u_modelView * vec4(a_position, 1.0);',
        '}',
    ]);

    var COLL_FRAG_SHADER_SOURCE = M([
        'void main() {',
        '    gl_FragColor = vec4(1.0, 1.0, 1.0, 0.2);',
        '#ifdef GL_EXT_frag_depth',
        '#extension GL_EXT_frag_depth : enable',
        '    gl_FragDepthEXT = gl_FragCoord.z - 1e-6;',
        '#endif',
        '}',
    ]);

    function createProgram_COLL(gl) {
        var vertShader = compileShader(gl, COLL_VERT_SHADER_SOURCE, gl.VERTEX_SHADER);
        var fragShader = compileShader(gl, COLL_FRAG_SHADER_SOURCE, gl.FRAGMENT_SHADER);
        var prog = gl.createProgram();
        gl.attachShader(prog, vertShader);
        gl.attachShader(prog, fragShader);
        gl.linkProgram(prog);
        prog.modelViewLocation = gl.getUniformLocation(prog, "u_modelView");
        prog.projectionLocation = gl.getUniformLocation(prog, "u_projection");
        prog.positionLocation = gl.getAttribLocation(prog, "a_position");
        return prog;
    }

    function makeModelFromScene(gl, scene) {
        var coll = scene.collision;
        var collVertBuffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, collVertBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, coll.verts, gl.STATIC_DRAW);

        function stitchLines(ibd) {
            var lines = new Uint16Array(ibd.length * 2);
            var o = 0;
            for (var i = 0; i < ibd.length; i += 3) {
                lines[o++] = ibd[i+0];
                lines[o++] = ibd[i+1];
                lines[o++] = ibd[i+1];
                lines[o++] = ibd[i+2];
                lines[o++] = ibd[i+2];
                lines[o++] = ibd[i+0];
            }
            return lines;
        }
        var collIdxBuffer = gl.createBuffer();
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, collIdxBuffer);
        var lineData = stitchLines(coll.polys);
        gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, lineData, gl.STATIC_DRAW);
        var nPrim = lineData.length;

        function renderCollision(state) {
            state.useProgram(state.programs_COLL);

            var prog = gl.currentProgram;
            gl.enable(gl.BLEND);
            gl.bindBuffer(gl.ARRAY_BUFFER, collVertBuffer);
            gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, collIdxBuffer);
            gl.vertexAttribPointer(prog.positionLocation, 3, gl.SHORT, false, 0, 0);
            gl.enableVertexAttribArray(prog.positionLocation);
            gl.drawElements(gl.LINES, nPrim, gl.UNSIGNED_SHORT, 0);
            gl.disableVertexAttribArray(prog.positionLocation);
            gl.disable(gl.BLEND);
        }

        function render(state) {
            function renderDL(dl) { dl.forEach(function(cmd) { cmd(gl); })}

            function renderMesh(mesh) {
                mesh.opaque.forEach(renderDL);
                mesh.transparent.forEach(renderDL);
            }

            function renderRoom(room) { renderMesh(room.mesh); }

            state.useProgram(state.programs_DL);
            scene.rooms.forEach(renderRoom);

            renderCollision(state);
        }

        return { render: render };
    }

    function sceneCombo(gl, viewer, manifest) {
        var pl = document.querySelector('#pl');

        var select = document.createElement('select');
        manifest.forEach(function(entry) {
            var option = document.createElement('option');
            option.textContent = entry.label;
            option.filename = entry.filename;
            select.appendChild(option);
        });
        pl.appendChild(select);
        var button = document.createElement('button');
        button.textContent = 'Load';
        button.addEventListener('click', function() {
            var option = select.childNodes[select.selectedIndex];
            viewer.loadScene(option.filename);
        });
        pl.appendChild(button);
    }

    function loadManifest(gl, viewer) {
        var req = fetch('manifest.json', 'json');
        req.onload = function() {
            var manifest = req.response;
            sceneCombo(gl, viewer, manifest);
        };
    }

    function createSceneGraph(gl) {
        var projection = mat4.create();
        mat4.perspective(projection, Math.PI / 4, gl.viewportWidth / gl.viewportHeight, 0.2, 50000);

        var view = mat4.create();

        gl.viewport(0, 0, gl.viewportWidth, gl.viewportHeight);
        gl.clearColor(200/255, 50/255, 153/255, 1);

        var models = [];
        var scene = {};

        var state = {};
        state.gl = gl;
        state.programs_DL = createProgram_DL(gl);
        state.programs_COLL = createProgram_COLL(gl);
        state.useProgram = function(prog) {
            gl.currentProgram = prog;
            gl.useProgram(prog);
            gl.uniformMatrix4fv(prog.projectionLocation, false, projection);
            gl.uniformMatrix4fv(prog.modelViewLocation, false, view);
        };

        function renderModel(model) {
            model.render(state);
        }

        function render() {
            gl.depthMask(true);
            gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
            models.forEach(renderModel);
        }

        scene.setModels = function(models_) {
            models = models_;
            render();
        };
        scene.setCamera = function(matrix) {
            mat4.invert(view, matrix);
            render();
        };

        return scene;
    }

    function createViewer() {
        var canvas = document.querySelector("canvas");
        var gl = canvas.getContext("webgl", { alpha: false });

        // Enable EXT_frag_depth
        gl.getExtension('EXT_frag_depth');

        gl.viewportWidth = canvas.width;
        gl.viewportHeight = canvas.height;

        var scene = createSceneGraph(gl);

        var camera = mat4.create();
        var filename = '';

        function serializeCamera(c) {
            var yaw = Math.atan2(-c[8], c[0]);
            var pitch = Math.asin(-c[6]);
            var posX = c[12];
            var posY = c[13];
            var posZ = c[14];
            return [yaw, pitch, posX, posY, posZ].map(function(n) { return n.toFixed(4); }).join(',');
        }
        function serializeState() {
            return [filename, serializeCamera(camera)].join('!');
        }
        var lastState;
        function stateUpdated() {
            var state = serializeState();
            if (state === lastState)
                return;

            window.history.replaceState('', '', '#' + state);
        }
        function deserializeCamera(c, S) {
            var parts = S.split(',').map(function(n) { return parseFloat(n); });
            var yaw = parts[0];
            var pitch = parts[1];
            var posX = parts[2], posY = parts[3], posZ = parts[4];
            mat4.identity(c);
            mat4.rotateY(c, c, -yaw);
            mat4.rotateX(c, c, -pitch);
            c[12] = posX; c[13] = posY; c[14] = posZ;
        }
        function loadState(S) {
            var parts = S.split('!');
            var filename_ = parts[0], cameraS = parts[1];
            if (!filename_)
                filename_ = 'ydan_scene';

            viewer.loadScene(filename_);
            deserializeCamera(camera, cameraS);
        }

        function loadScene(filename) {
            var textures = document.querySelector('#textures');
            scene.setModels([]);
            viewer.resetCamera();
            textures.innerHTML = '';

            var fn = 'scenes/' + filename + '.zelview0';
            var req = fetch(fn);
            req.onload = function() {
                var zelview0 = readZELVIEW0(req.response);
                var zelScene = zelview0.loadMainScene(gl);
                var model = makeModelFromScene(gl, zelScene);
                scene.setModels([model]);
            };
        }

        var viewer = {};
        viewer.gl = gl;
        viewer.loadScene = function(filename_) {
            filename = filename_;
            loadScene(filename);
        };
        viewer.resetCamera = function() {
            mat4.identity(camera);
            scene.setCamera(camera);
            stateUpdated();
        };

        var hash = window.location.hash.slice(1);
        loadState(hash);

        var keysDown = {};
        var SHIFT = 16;

        function isKeyDown(key) {
            return !!keysDown[key.charCodeAt(0)];
        }

        window.addEventListener('keydown', function(e) {
            keysDown[e.keyCode] = true;
        });
        window.addEventListener('keyup', function(e) {
            delete keysDown[e.keyCode];
        });

        function pointerLockDragger(elem, callback) {
            function isInPointerLock() {
                return document.pointerLockElement === elem || document.mozPointerLockElement === elem || document.webkitPointerLockElement === elem;
            }
            document.exitPointerLock = document.exitPointerLock || document.mozExitPointerLock || document.webkitExitPointerLock;
             elem.addEventListener('click', function(e) {
                if (isInPointerLock())
                    document.exitPointerLock();
                else
                    elem.requestPointerLock();
            });
            function mousemove(e) {
                var dx = e.movementX || e.mozMovementX || e.webkitMovementX || 0;
                var dy = e.movementY || e.mozMovementY || e.webkitMovementY || 0;
                callback(dx, dy);
            }
            function pointerlockchange() {
                if (isInPointerLock())
                    elem.addEventListener('mousemove', mousemove);
                else
                    elem.removeEventListener('mousemove', mousemove);
            }
            document.addEventListener('pointerlockchange', pointerlockchange);
            document.addEventListener('mozpointerlockchange', pointerlockchange);
            document.addEventListener('webkitpointerlockchange', pointerlockchange);
        }
        function traditionalDragger(elem, callback) {
            var lx, ly;

            function mousemove(e) {
                var dx = e.pageX - lx, dy = e.pageY - ly;
                lx = e.pageX; ly = e.pageY;
                callback(dx, dy);
            }
            function mouseup(e) {
                document.removeEventListener('mouseup', mouseup);
                document.removeEventListener('mousemove', mousemove);
            }
            elem.addEventListener('mousedown', function(e) {
                lx = e.pageX; ly = e.pageY;
                document.addEventListener('mouseup', mouseup);
                document.addEventListener('mousemove', mousemove);
            });
        }

        function elemDragger(elem, callback) {
            elem.requestPointerLock = elem.requestPointerLock || elem.mozRequestPointerLock || elem.webkitRequestPointerLock;

            if (elem.requestPointerLock) {
                return pointerLockDragger(elem, callback);
            } else {
                return traditionalDragger(elem, callback);
            }
        }

        elemDragger(canvas, function(dx, dy) {
            var cu = [camera[1], camera[5], camera[9]];
            vec3.normalize(cu, cu);
            mat4.rotate(camera, camera, -dx / 500, cu);
            mat4.rotate(camera, camera, -dy / 500, [1, 0, 0]);
        });

        var tmp = mat4.create();
        var t = 0;
        function update(nt) {
            var dt = nt - t;
            t = nt;

            var mult = 20;
            if (keysDown[SHIFT])
                mult *= 10;
            mult *= (dt / 16.0);

            var amt;
            amt = 0;
            if (isKeyDown('W'))
                amt = -mult;
            else if (isKeyDown('S'))
                amt = mult;
            tmp[14] = amt;

            amt = 0;
            if (isKeyDown('A'))
                amt = -mult;
            else if (isKeyDown('D'))
                amt = mult;
            tmp[12] = amt;

            if (isKeyDown('B'))
                mat4.identity(camera);
            if (isKeyDown('C'))
                console.log(camera);

            mat4.multiply(camera, camera, tmp);

            scene.setCamera(camera);
            stateUpdated();
            window.requestAnimationFrame(update);
        }
        update(0);

        return viewer;
    }

    window.addEventListener('load', function() {
        var viewer = createViewer();
        loadManifest(viewer.gl, viewer);
    });

})(window);
