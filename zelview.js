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

    var VERT_SHADER_SOURCE = M([
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

    var FRAG_SHADER_SOURCE = M([
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

    function createProgram(gl) {
        var vertShader = compileShader(gl, VERT_SHADER_SOURCE, gl.VERTEX_SHADER);
        var fragShader = compileShader(gl, FRAG_SHADER_SOURCE, gl.FRAGMENT_SHADER);
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

    function makeModelFromScene(scene) {
        function render(gl) {
            function renderDL(dl) { dl.forEach(function(cmd) { cmd(gl); })}

            function renderMesh(mesh) {
                mesh.opaque.forEach(renderDL);
                mesh.transparent.forEach(renderDL);
            }

            function renderRoom(room) { renderMesh(room.mesh); }
            scene.rooms.forEach(renderRoom);
        }

        return { render: render };
    }

    function sceneCombo(gl, sceneGraph, manifest) {
        var select = document.createElement('select');
        manifest.forEach(function(entry) {
            var option = document.createElement('option');
            option.textContent = entry.label;
            option.zelview0 = entry.filename;
            select.appendChild(option);
        });
        document.body.appendChild(select);
        var button = document.createElement('button');
        button.textContent = 'Load';
        button.addEventListener('click', function() {
            sceneGraph.setModels([]);

            var option = select.childNodes[select.selectedIndex];
            var fn = 'scenes/' + option.zelview0 + '.zelview0';
            var req = fetch(fn);
            req.onload = function() {
                var zelview0 = readZELVIEW0(req.response);
                var scene = zelview0.loadMainScene(gl);
                var model = makeModelFromScene(scene);
                sceneGraph.setModels([model]);
            };
        });
        document.body.appendChild(button);
    }

    function loadManifest(gl, sceneGraph) {
        var req = fetch('manifest.json', 'json');
        req.onload = function() {
            var manifest = req.response;
            sceneCombo(gl, sceneGraph, manifest);
        };
    }

    function createScene(gl) {
        var projection = mat4.create();
        mat4.perspective(projection, Math.PI / 4, gl.viewportWidth / gl.viewportHeight, 0.2, 10000);

        var view = mat4.create();

        gl.viewport(0, 0, gl.viewportWidth, gl.viewportHeight);
        gl.clearColor(200/255, 50/255, 153/255, 1);

        var models = [];
        var scene = {};

        function renderModel(model) {
            model.render(gl);
        }

        var prog = createProgram(gl);

        function render() {
            gl.depthMask(true);
            gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

            gl.currentProgram = prog;
            gl.useProgram(prog);
            gl.uniformMatrix4fv(prog.projectionLocation, false, projection);
            gl.uniformMatrix4fv(prog.modelViewLocation, false, view);

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

    window.addEventListener('load', function() {
        var canvas = document.querySelector("canvas");
        var gl = canvas.getContext("webgl", { alpha: false });
        gl.viewportWidth = canvas.width;
        gl.viewportHeight = canvas.height;

        var scene = createScene(gl);
        var camera = mat4.create();
        scene.setCamera(camera);

        loadManifest(gl, scene);
        // loadROM(gl, scene);

        var keysDown = {};
        var dragging = false, lx = 0, ly = 0;
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

        canvas.addEventListener('mousedown', function(e) {
            dragging = true;
            lx = e.pageX; ly = e.pageY;
        });
        canvas.addEventListener('mouseup', function(e) {
            dragging = false;
        });
        canvas.addEventListener('mousemove', function(e) {
            if (!dragging)
                return;

            var dx = e.pageX - lx;
            var dy = e.pageY - ly;
            var cu = [camera[1], camera[5], camera[9]];
            vec3.normalize(cu, cu);
            mat4.rotate(camera, camera, -dx / 500, cu);
            mat4.rotate(camera, camera, -dy / 500, [1, 0, 0]);
            lx = e.pageX; ly = e.pageY;
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
            window.requestAnimationFrame(update);
        }

        update(0);
    });

})(window);
