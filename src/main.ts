import './style.css';
import * as THREE from 'three';

const TAU = Math.PI * 2;
const MAJOR_RADIUS = 11.8;
const TUBE_RADIUS = 4.7;
const MOBILE = matchMedia('(max-width: 700px)').matches;
const REDUCED_MOTION = matchMedia('(prefers-reduced-motion: reduce)').matches;

interface Parameters {
  position: number;
  spine: number;
  pressure: number;
  teeth: number;
  turning: number;
}

interface RingUniforms {
  [key: string]: { value: number };
  uTime: { value: number };
  uPressure: { value: number };
  uTeeth: { value: number };
  uSpine: { value: number };
  uPosition: { value: number };
  uPulse: { value: number };
}

const parameters: Parameters = {
  position: 0,
  spine: 0,
  pressure: .42,
  teeth: 24,
  turning: .7,
};

function get<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Missing #${id}`);
  return node as T;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state += 0x6D2B79F5;
    let value = state;
    value = Math.imul(value ^ value >>> 15, value | 1);
    value ^= value + Math.imul(value ^ value >>> 7, value | 61);
    return ((value ^ value >>> 14) >>> 0) / 4294967296;
  };
}

class InnerRing {
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(67, 1, .025, 90);
  private readonly renderer: THREE.WebGLRenderer;
  private readonly clock = new THREE.Clock();
  private readonly world = new THREE.Group();
  private readonly wall: THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>;
  private readonly motes: THREE.Points<THREE.BufferGeometry, THREE.PointsMaterial>;
  private readonly uniforms: RingUniforms;
  private elapsed = 0;
  private pulseStrength = 0;
  private paused = false;
  private active = false;
  private dragging = false;
  private previousPointer = new THREE.Vector2();
  private yaw = 0;
  private pitch = 0;
  onPositionChange: ((value: number) => void) | undefined;

  constructor(private readonly host: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({
      antialias: !MOBILE,
      powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, MOBILE ? 1.45 : 1.9));
    this.renderer.setSize(host.clientWidth, host.clientHeight, false);
    this.renderer.setClearColor(0x030108, 1);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.25;
    host.append(this.renderer.domElement);

    this.scene.fog = new THREE.FogExp2(0x030108, .022);
    this.scene.add(this.world);

    this.uniforms = {
      uTime: { value: 0 },
      uPressure: { value: parameters.pressure },
      uTeeth: { value: parameters.teeth },
      uSpine: { value: parameters.spine },
      uPosition: { value: parameters.position },
      uPulse: { value: 0 },
    };

    this.wall = this.createWall();
    this.world.add(this.wall);
    this.motes = this.createMotes();
    this.world.add(this.motes);
    this.addAxisFilaments();
    this.bindGestures();
    addEventListener('resize', () => this.resize());
    this.updateCamera();
    this.animate();
  }

  start(): void {
    this.active = true;
    this.clock.getDelta();
    this.resize();
  }

  setPosition(value: number, announce = false): void {
    parameters.position = clamp(value, -.96, .96);
    this.uniforms.uPosition.value = parameters.position;
    this.updateCamera();
    if (announce) this.onPositionChange?.(parameters.position);
  }

  setSpine(value: number): void {
    parameters.spine = clamp(value, -1, 1);
    this.uniforms.uSpine.value = parameters.spine;
    this.updateCamera();
  }

  setPressure(value: number): void {
    parameters.pressure = clamp(value, .05, 1);
    this.uniforms.uPressure.value = parameters.pressure;
  }

  setTeeth(value: number): void {
    parameters.teeth = Math.round(clamp(value, 8, 48));
    this.uniforms.uTeeth.value = parameters.teeth;
  }

  setTurning(value: number): void {
    parameters.turning = clamp(value, 0, 2);
  }

  togglePause(): boolean {
    this.paused = !this.paused;
    return this.paused;
  }

  pulse(): void {
    this.pulseStrength = 1;
  }

  reset(): void {
    this.elapsed = 0;
    this.pulseStrength = 0;
    this.yaw = 0;
    this.pitch = 0;
    this.world.rotation.set(0, 0, 0);
    this.setPosition(0, true);
    this.setSpine(0);
  }

  private createWall(): THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial> {
    const geometry = new THREE.TorusGeometry(
      MAJOR_RADIUS,
      TUBE_RADIUS,
      MOBILE ? 88 : 144,
      MOBILE ? 220 : 360,
    );
    const material = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      side: THREE.BackSide,
      depthWrite: true,
      vertexShader: `
        precision highp float;

        uniform float uTime;
        uniform float uPressure;
        uniform float uTeeth;
        uniform float uSpine;
        uniform float uPulse;

        varying vec2 vUv;
        varying float vDeformation;
        varying float vTerrace;
        varying vec3 vWorldPosition;
        varying vec3 vWorldNormal;

        const float PI = 3.141592653589793;
        const float TAU = 6.283185307179586;

        void main() {
          float along = uv.x * TAU;
          float around = uv.y * TAU;

          float longWave = sin(along * 3.0 - uTime * .43 + sin(around * 2.0 + uTime * .19));
          float crossWave = sin(around * 4.0 + uTime * .61 - cos(along * 5.0 - uTime * .14));
          float interference = sin(along * 8.0 - around * 3.0 + uTime * .27);
          float compression = longWave * .48 + crossWave * .34 + interference * .18;
          float terrace = floor((compression * .5 + .5) * 7.0) / 6.0 - .5;

          float toothWave = sin(around * uTeeth + sin(along * 4.0 - uTime * .24) * 1.8);
          float tooth = floor((toothWave * .5 + .5) * 4.0) / 3.0 - .5;
          float spineBias = uSpine * sin(around) * (.22 + .18 * sin(along * 2.0 - uTime * .2));
          float pulse = uPulse * sin(along * 10.0 - uTime * 7.0) * exp(-abs(sin(around)) * 1.6);
          float displacement = uPressure * (compression * .5 + terrace * .36 + spineBias) + tooth * .32 + pulse * .45;
          float tubeRadius = ${TUBE_RADIUS.toFixed(1)} + displacement;

          float ca = cos(along);
          float sa = sin(along);
          float cr = cos(around);
          float sr = sin(around);
          vec3 localPosition = vec3(
            (${MAJOR_RADIUS.toFixed(1)} + tubeRadius * cr) * ca,
            tubeRadius * sr,
            (${MAJOR_RADIUS.toFixed(1)} + tubeRadius * cr) * sa
          );
          vec3 localNormal = normalize(vec3(ca * cr, sr, sa * cr));
          vec4 world = modelMatrix * vec4(localPosition, 1.0);

          vUv = uv;
          vDeformation = displacement;
          vTerrace = terrace;
          vWorldPosition = world.xyz;
          vWorldNormal = normalize(mat3(modelMatrix) * localNormal);
          gl_Position = projectionMatrix * viewMatrix * world;
        }
      `,
      fragmentShader: `
        precision highp float;

        uniform float uTime;
        uniform float uPressure;
        uniform float uTeeth;
        uniform float uSpine;
        uniform float uPosition;
        uniform float uPulse;

        varying vec2 vUv;
        varying float vDeformation;
        varying float vTerrace;
        varying vec3 vWorldPosition;
        varying vec3 vWorldNormal;

        const float PI = 3.141592653589793;
        const float TAU = 6.283185307179586;

        float hash(vec2 p) {
          p = fract(p * vec2(123.34, 456.21));
          p += dot(p, p + 45.32);
          return fract(p.x * p.y);
        }

        vec3 spectrum(float t) {
          vec3 phase = vec3(.02, .28, .58);
          return .52 + .48 * cos(TAU * (phase + t));
        }

        void main() {
          float along = vUv.x * TAU;
          float around = vUv.y * TAU;
          float flow = along * 7.0 - uTime * .82 + sin(around * 5.0 + uTime * .31) * 1.5;
          float marble = sin(flow + sin(flow * .37 + around * 3.0) * 3.2);
          float interference = sin(along * 19.0 + around * 11.0 - uTime * 1.25);
          float chroma = marble * .13 + interference * .035 + vDeformation * .16 + vTerrace * .09;
          vec3 color = spectrum(chroma + .09 * sin(uTime * .11));
          color = color * color * 1.05;

          float crossRib = pow(abs(sin(around * uTeeth * .5 + sin(along * 4.0 - uTime * .25))), 17.0);
          float longRib = pow(abs(sin(along * 44.0 + around * 1.5)), 24.0);
          float contour = 1.0 - smoothstep(.025, .12, abs(fract((vDeformation + 2.0) * 3.2) - .5));
          vec3 ridgeColor = mix(vec3(.20, .98, .92), vec3(1.0, .55, .74), .5 + .5 * sin(along * 2.0));
          color += ridgeColor * (crossRib * .58 + longRib * .15 + contour * .1) * (1.0 + uPressure * .35);

          float contactAngle = uPosition >= 0.0 ? 0.0 : PI;
          float contactFacing = pow(.5 + .5 * cos(around - contactAngle), 7.0);
          float proximity = smoothstep(.62, .96, abs(uPosition));
          vec3 contactColor = uPosition >= 0.0 ? vec3(1.0, .18, .52) : vec3(.12, .88, 1.0);
          color = mix(color, contactColor + color * 1.1, contactFacing * proximity * .58);

          vec3 viewDirection = normalize(cameraPosition - vWorldPosition);
          float grazing = pow(1.0 - abs(dot(viewDirection, vWorldNormal)), 2.2);
          color += vec3(.3, .16, .62) * grazing * .32;
          color += vec3(.95, .86, .72) * uPulse * crossRib * .35;
          color *= .63 + .37 * smoothstep(-1.2, 1.2, vDeformation + uSpine * .2);

          float grain = hash(gl_FragCoord.xy + floor(uTime * 24.0));
          color += (grain - .5) * .035;
          float distanceToEye = distance(cameraPosition, vWorldPosition);
          float fog = exp(-distanceToEye * .026);
          color = mix(vec3(.006, .002, .018), color, clamp(fog, .0, 1.0));
          gl_FragColor = vec4(color, 1.0);
        }
      `,
    });
    return new THREE.Mesh(geometry, material);
  }

  private createMotes(): THREE.Points<THREE.BufferGeometry, THREE.PointsMaterial> {
    const count = MOBILE ? 2400 : 6200;
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    const random = seededRandom(0x1A2B3C4D);
    const cyan = new THREE.Color(0x7ff1e6);
    const rose = new THREE.Color(0xff6e9d);
    const violet = new THREE.Color(0x9c8cff);
    const mixed = new THREE.Color();

    for (let index = 0; index < count; index += 1) {
      const along = random() * TAU;
      const around = random() * TAU;
      const radius = Math.sqrt(random()) * TUBE_RADIUS * .79;
      const offset = radius * Math.cos(around);
      const pointer = index * 3;
      positions[pointer] = (MAJOR_RADIUS + offset) * Math.cos(along);
      positions[pointer + 1] = radius * Math.sin(around);
      positions[pointer + 2] = (MAJOR_RADIUS + offset) * Math.sin(along);

      const selector = random();
      mixed.copy(selector < .42 ? cyan : selector < .76 ? violet : rose);
      mixed.multiplyScalar(.55 + random() * .45);
      colors[pointer] = mixed.r;
      colors[pointer + 1] = mixed.g;
      colors[pointer + 2] = mixed.b;
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    const material = new THREE.PointsMaterial({
      size: MOBILE ? .035 : .028,
      transparent: true,
      opacity: .58,
      vertexColors: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      sizeAttenuation: true,
    });
    return new THREE.Points(geometry, material);
  }

  private addAxisFilaments(): void {
    const colors = [0x75e9df, 0xff6e9d, 0xffc278];
    for (let filament = 0; filament < colors.length; filament += 1) {
      const points: THREE.Vector3[] = [];
      const count = MOBILE ? 360 : 700;
      for (let index = 0; index < count; index += 1) {
        const angle = index / count * TAU;
        const phase = angle * (filament + 2) + filament * TAU / 3;
        const offset = .18 + filament * .055;
        const radial = offset * Math.cos(phase);
        points.push(new THREE.Vector3(
          (MAJOR_RADIUS + radial) * Math.cos(angle),
          offset * Math.sin(phase),
          (MAJOR_RADIUS + radial) * Math.sin(angle),
        ));
      }
      const geometry = new THREE.BufferGeometry().setFromPoints(points);
      const material = new THREE.LineBasicMaterial({
        color: colors[filament],
        transparent: true,
        opacity: .44 - filament * .08,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
      this.world.add(new THREE.LineLoop(geometry, material));
    }
  }

  private bindGestures(): void {
    const canvas = this.renderer.domElement;
    canvas.addEventListener('pointerdown', (event) => {
      this.dragging = true;
      this.previousPointer.set(event.clientX, event.clientY);
      canvas.setPointerCapture(event.pointerId);
    });
    canvas.addEventListener('pointermove', (event) => {
      if (!this.dragging) return;
      const deltaX = event.clientX - this.previousPointer.x;
      const deltaY = event.clientY - this.previousPointer.y;
      this.previousPointer.set(event.clientX, event.clientY);
      this.yaw = clamp(this.yaw + deltaX * .0034, -1.32, 1.32);
      this.pitch = clamp(this.pitch - deltaY * .0028, -.72, .72);
      this.updateCamera();
    });
    const stopDragging = (event: PointerEvent) => {
      this.dragging = false;
      if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
    };
    canvas.addEventListener('pointerup', stopDragging);
    canvas.addEventListener('pointercancel', stopDragging);
    canvas.addEventListener('dblclick', () => {
      this.yaw = 0;
      this.pitch = 0;
      this.updateCamera();
    });
    canvas.addEventListener('wheel', (event) => {
      event.preventDefault();
      this.setPosition(parameters.position + event.deltaY * .00085, true);
    }, { passive: false });

    addEventListener('keydown', (event) => {
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLButtonElement) return;
      if (event.key === 'w' || event.key === 'W' || event.key === 'ArrowUp') {
        event.preventDefault();
        this.setPosition(parameters.position + .045, true);
      }
      if (event.key === 's' || event.key === 'S' || event.key === 'ArrowDown') {
        event.preventDefault();
        this.setPosition(parameters.position - .045, true);
      }
    });
  }

  private updateCamera(): void {
    const displacement = parameters.position * TUBE_RADIUS * .88;
    const breath = Math.sin(this.elapsed * .73) * .025 * parameters.pressure;
    this.camera.position.set(MAJOR_RADIUS + displacement, parameters.spine * .34 + breath, 0);

    const posturePitch = parameters.spine * .13;
    const totalPitch = this.pitch + posturePitch;
    const direction = new THREE.Vector3(
      Math.cos(this.yaw) * Math.cos(totalPitch),
      Math.sin(totalPitch),
      Math.sin(this.yaw) * Math.cos(totalPitch),
    );
    const roll = parameters.spine * -.24;
    this.camera.up.set(0, Math.cos(roll), Math.sin(roll)).normalize();
    this.camera.lookAt(this.camera.position.clone().add(direction));
  }

  private resize(): void {
    const width = this.host.clientWidth;
    const height = this.host.clientHeight;
    if (width === 0 || height === 0) return;
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height, false);
  }

  private animate = (): void => {
    requestAnimationFrame(this.animate);
    const delta = Math.min(this.clock.getDelta(), .05);
    if (!this.active) return;

    if (!this.paused) {
      const motionScale = REDUCED_MOTION ? .18 : 1;
      this.elapsed += delta * motionScale;
      this.pulseStrength = Math.max(0, this.pulseStrength - delta * .34);
      this.uniforms.uTime.value = this.elapsed;
      this.uniforms.uPulse.value = this.pulseStrength;
      this.world.rotation.y = this.elapsed * parameters.turning * .055;
      this.world.rotation.x = Math.sin(this.elapsed * .13) * parameters.spine * .018;
      this.motes.rotation.y = -this.elapsed * parameters.turning * .018;
      this.updateCamera();
    }
    this.renderer.render(this.scene, this.camera);
  };
}

const threshold = get<HTMLElement>('threshold');
const instrument = get<HTMLElement>('instrument');
let ring: InnerRing;

try {
  ring = new InnerRing(get<HTMLElement>('scene'));
} catch (error) {
  const message = error instanceof Error ? error.message : 'WebGL could not start.';
  get<HTMLButtonElement>('enter-button').disabled = true;
  get<HTMLButtonElement>('enter-button').querySelector('span')!.textContent = 'This browser cannot enter';
  get<HTMLElement>('threshold').setAttribute('data-error', message);
  throw error;
}

const positionInput = get<HTMLInputElement>('position');
const spineInput = get<HTMLInputElement>('spine');
const pressureInput = get<HTMLInputElement>('pressure');
const teethInput = get<HTMLInputElement>('teeth');
const turningInput = get<HTMLInputElement>('turning');

function describePosition(value: number): string {
  if (value > .78) return 'front contact';
  if (value > .24) return 'forward';
  if (value < -.78) return 'back contact';
  if (value < -.24) return 'backward';
  return 'center';
}

function describeSpine(value: number): string {
  if (value > .58) return 'extended';
  if (value > .16) return 'rising';
  if (value < -.58) return 'curled';
  if (value < -.16) return 'yielding';
  return 'neutral';
}

function updateCondition(): void {
  const value = parameters.position;
  const magnitude = Math.abs(value);
  const front = value >= 0;
  let title = 'The walls move around you.';
  let copy = 'The channel is continuous. What feels like forward and back is a position inside its living cross-section.';
  let state = 'CENTERED IN THE CHANNEL';

  if (magnitude > .78) {
    title = front ? 'The front membrane fills perception.' : 'The back membrane remembers you.';
    copy = front
      ? 'Near contact, texture stops behaving like surface and begins behaving like an event.'
      : 'The rear boundary gathers pressure into cold bands. Distance and memory become difficult to separate.';
    state = front ? 'ANTERIOR MEMBRANE / NEAR' : 'POSTERIOR MEMBRANE / NEAR';
  } else if (magnitude > .3) {
    title = front ? 'You lean into the arriving wall.' : 'You recede toward the returning wall.';
    copy = 'The center no longer protects symmetry. One side becomes environment; the other becomes implication.';
    state = front ? 'MOVING FORWARD' : 'MOVING BACKWARD';
  } else if (Math.abs(parameters.spine) > .55) {
    title = parameters.spine > 0 ? 'The spine extends into the field.' : 'The spine yields to the field.';
    copy = 'Posture changes the channel because the observer is one of its boundary conditions.';
    state = parameters.spine > 0 ? 'POSTURE / EXTENDED' : 'POSTURE / CURLED';
  }

  get('condition-title').textContent = title;
  get('condition-copy').textContent = copy;
  get('state-label').textContent = state;
  get('position-readout').textContent = value.toFixed(2);
  get('clearance-readout').textContent = `${Math.round((1 - magnitude / .96) * 100)}%`;
  const fieldLoad = clamp(parameters.pressure * (1 + Math.abs(parameters.spine) * .34), 0, 1);
  get('load-readout').textContent = `${Math.round(fieldLoad * 100)}%`;
  get<HTMLElement>('axis-marker').style.left = `${(value + .96) / 1.92 * 100}%`;
  document.documentElement.style.setProperty('--contact', clamp((magnitude - .6) / .36, 0, 1).toFixed(3));
  document.documentElement.style.setProperty('--contact-hue', front ? '332' : '185');
}

function updatePosition(value: number, fromRing = false): void {
  if (!fromRing) ring.setPosition(value);
  positionInput.value = parameters.position.toString();
  get<HTMLOutputElement>('position-output').value = describePosition(parameters.position);
  updateCondition();
}

ring.onPositionChange = (value) => updatePosition(value, true);

function enterChannel(): void {
  threshold.classList.add('is-hidden');
  instrument.classList.remove('is-hidden');
  ring.start();
}

get<HTMLButtonElement>('enter-button').addEventListener('click', enterChannel);

positionInput.addEventListener('input', () => updatePosition(Number(positionInput.value)));
spineInput.addEventListener('input', () => {
  ring.setSpine(Number(spineInput.value));
  get<HTMLOutputElement>('spine-output').value = describeSpine(parameters.spine);
  updateCondition();
});
pressureInput.addEventListener('input', () => {
  ring.setPressure(Number(pressureInput.value));
  get<HTMLOutputElement>('pressure-output').value = `${Math.round(parameters.pressure * 100)}%`;
  updateCondition();
});
teethInput.addEventListener('input', () => {
  ring.setTeeth(Number(teethInput.value));
  get<HTMLOutputElement>('teeth-output').value = parameters.teeth.toString();
});
turningInput.addEventListener('input', () => {
  ring.setTurning(Number(turningInput.value));
  get<HTMLOutputElement>('turning-output').value = `${parameters.turning.toFixed(1)}×`;
});

get<HTMLButtonElement>('pulse-button').addEventListener('click', () => ring.pulse());
get<HTMLButtonElement>('reset-button').addEventListener('click', () => {
  ring.reset();
  positionInput.value = '0';
  spineInput.value = '0';
  get<HTMLOutputElement>('position-output').value = 'center';
  get<HTMLOutputElement>('spine-output').value = 'neutral';
  updateCondition();
});

get<HTMLButtonElement>('pause-button').addEventListener('click', (event) => {
  const button = event.currentTarget as HTMLButtonElement;
  const paused = ring.togglePause();
  button.textContent = paused ? '▶' : 'Ⅱ';
  button.setAttribute('aria-label', paused ? 'Resume simulation' : 'Pause simulation');
});

get<HTMLButtonElement>('controls-toggle').addEventListener('click', (event) => {
  const panel = get('controls-panel');
  panel.classList.toggle('is-collapsed');
  const collapsed = panel.classList.contains('is-collapsed');
  const button = event.currentTarget as HTMLButtonElement;
  button.textContent = collapsed ? '+' : '−';
  button.setAttribute('aria-label', collapsed ? 'Expand controls' : 'Collapse controls');
});

updateCondition();

if (new URLSearchParams(location.search).has('enter')) enterChannel();
