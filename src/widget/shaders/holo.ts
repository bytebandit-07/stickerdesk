import * as THREE from 'three';

export interface HoloShaderUniforms {
  [uniform: string]: THREE.IUniform<unknown>;
  uMap: THREE.IUniform<THREE.Texture | null>;
  uTime: THREE.IUniform<number>;
  uTilt: THREE.IUniform<THREE.Vector2>;
  uOpacity: THREE.IUniform<number>;
}

const HOLO_VERTEX_SHADER = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vNormalView;
  varying vec3 vViewDir;

  void main() {
    vUv = uv;
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    vNormalView = normalize(normalMatrix * normal);
    vViewDir = normalize(-mvPosition.xyz);
    gl_Position = projectionMatrix * mvPosition;
  }
`;

const HOLO_FRAGMENT_SHADER = /* glsl */ `
  uniform sampler2D uMap;
  uniform float uTime;
  uniform vec2 uTilt;
  uniform float uOpacity;

  varying vec2 vUv;
  varying vec3 vNormalView;
  varying vec3 vViewDir;

  // Soft iridescent rainbow palette (natural pearl/silver foil sheen)
  vec3 softRainbow(float t) {
    vec3 a = vec3(0.65, 0.65, 0.68);
    vec3 b = vec3(0.35, 0.35, 0.32);
    vec3 c = vec3(1.0, 1.0, 1.0);
    vec3 d = vec3(0.00, 0.33, 0.67);
    return a + b * cos(6.28318 * (c * t + d));
  }

  void main() {
    vec4 texColor = texture2D(uMap, vUv);
    if (texColor.a < 0.04) {
      discard;
    }

    vec3 N = normalize(vNormalView);
    vec3 V = normalize(vViewDir);

    float ndotv = clamp(dot(N, V), 0.0, 1.0);
    float fresnel = pow(1.0 - ndotv, 2.0);

    // Subtle tilt magnitude (when still, tiltMag is 0 so foil stays clean and quiet)
    float tiltMag = length(uTilt);

    // Dynamic diagonal glare band that sweeps across only when tilted
    float diagCoord = (vUv.x * 1.4 - vUv.y * 1.1) + (uTilt.x - uTilt.y) * 1.25;
    float glareBand1 = exp(-pow(fract(diagCoord + uTime * 0.04) - 0.5, 2.0) * 55.0);
    float glareBand2 = exp(-pow(fract(diagCoord * 1.8 - uTime * 0.03) - 0.5, 2.0) * 75.0);
    float movingGlare = clamp(glareBand1 * 0.65 + glareBand2 * 0.35, 0.0, 1.0);

    // Surface angle-driven rainbow wave
    float rainbowPhase = (vUv.x * 1.6 + vUv.y * 1.3) + (uTilt.x * 1.5 - uTilt.y * 1.5) + uTime * 0.12;
    vec3 rainbow = softRainbow(rainbowPhase);

    // Specular highlight from studio light
    vec3 lightDir = normalize(vec3(uTilt.x * 2.2 + 0.35, uTilt.y * 2.2 + 0.65, 1.0));
    vec3 halfVec = normalize(lightDir + V);
    float spec = pow(max(dot(N, halfVec), 0.0), 38.0);

    // Mask foil intensity: Keep original artwork 100% visible, foil only reflects as a sleek sheen
    // Still mode has very faint classy pearlescence (0.05), increasing dynamically with tilt & glare
    float foilStrength = (0.05 + tiltMag * 0.18 + movingGlare * 0.38 + fresnel * 0.22);
    foilStrength = clamp(foilStrength, 0.0, 0.60);

    // Additive screen sheen so the base artwork (Spider-man's true colors) is never washed out
    vec3 sheenColor = rainbow * foilStrength;
    vec3 finalRgb = texColor.rgb + sheenColor * (1.0 - texColor.rgb * 0.45);
    finalRgb += vec3(1.0, 0.98, 0.95) * (spec * 0.35);

    gl_FragColor = vec4(finalRgb, texColor.a * uOpacity);
  }
`;

export function createHoloMaterial(
  texture: THREE.Texture,
  opacity: number
): THREE.ShaderMaterial {
  const uniforms: HoloShaderUniforms = {
    uMap: { value: texture },
    uTime: { value: 0 },
    uTilt: { value: new THREE.Vector2(0, 0) },
    uOpacity: { value: opacity },
  };

  return new THREE.ShaderMaterial({
    uniforms,
    vertexShader: HOLO_VERTEX_SHADER,
    fragmentShader: HOLO_FRAGMENT_SHADER,
    transparent: true,
    depthWrite: true,
    side: THREE.DoubleSide,
  });
}
