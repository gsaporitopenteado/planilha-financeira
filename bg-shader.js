// Animated gradient backdrop, in the spirit of pmndrs/react-three-fiber +
// ruucm/shadergradient — but as a plain three.js scene (no React/bundler),
// so the site keeps its zero-build static deploy. Falls back to the CSS
// gradient already set on #bg-canvas if WebGL or the CDN import fails.
const canvas = document.getElementById('bg-canvas');
if (!canvas) throw new Error('missing #bg-canvas');

const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const VERTEX = `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position, 1.0);
  }
`;

const FRAGMENT = `
  varying vec2 vUv;
  uniform float uTime;
  uniform float uAspect;
  uniform vec3 uColorA;
  uniform vec3 uColorB;
  uniform vec3 uColorC;
  uniform vec3 uColorD;

  float hash(vec2 p) { return fract(sin(dot(p, vec2(41.3, 289.1))) * 43758.5453); }
  float noise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    float a = hash(i), b = hash(i + vec2(1.0, 0.0));
    float c = hash(i + vec2(0.0, 1.0)), d = hash(i + vec2(1.0, 1.0));
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(a, b, u.x) + (c - a) * u.y * (1.0 - u.x) + (d - b) * u.x * u.y;
  }

  void main() {
    vec2 uv = vec2(vUv.x * uAspect, vUv.y);
    float t = uTime * 0.045;

    float n1 = noise(uv * 1.6 + vec2(t, -t * 0.8));
    float n2 = noise(uv * 2.4 + vec2(-t * 1.1, t * 0.6));
    float n3 = noise(uv * 1.1 - vec2(t * 0.5, t * 0.9));

    vec3 col = mix(uColorA, uColorB, smoothstep(0.15, 0.85, uv.y * 0.6 + n1 * 0.5));
    col = mix(col, uColorC, smoothstep(0.35, 0.9, n2));
    col = mix(col, uColorD, smoothstep(0.55, 1.0, n3));

    gl_FragColor = vec4(col, 1.0);
  }
`;

async function start() {
  const THREE = await import('https://esm.sh/three@0.169.0');

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'low-power' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));

  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

  const uniforms = {
    uTime: { value: 0 },
    uAspect: { value: window.innerWidth / window.innerHeight },
    uColorA: { value: new THREE.Color('#0071e3') },
    uColorB: { value: new THREE.Color('#001233') },
    uColorC: { value: new THREE.Color('#1a8f4c') },
    uColorD: { value: new THREE.Color('#7d2fb0') },
  };

  const material = new THREE.ShaderMaterial({ vertexShader: VERTEX, fragmentShader: FRAGMENT, uniforms });
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material);
  scene.add(quad);

  function resize() {
    const w = window.innerWidth, h = window.innerHeight;
    renderer.setSize(w, h);
    uniforms.uAspect.value = w / h;
  }
  resize();
  window.addEventListener('resize', resize);

  let frame = null;
  const clock = new THREE.Clock();

  function renderOnce() {
    renderer.render(scene, camera);
  }

  function loop() {
    uniforms.uTime.value = clock.getElapsedTime();
    renderOnce();
    frame = requestAnimationFrame(loop);
  }

  if (reduceMotion) {
    renderOnce();
  } else {
    loop();
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        if (frame) cancelAnimationFrame(frame);
        frame = null;
      } else if (!frame) {
        loop();
      }
    });
  }
}

start().catch(() => {
  // Leave the CSS gradient fallback on #bg-canvas (no WebGL / offline / CDN blocked).
});
