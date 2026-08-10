import * as faceapi from "face-api.js";

const MODEL_URL = "/model/face-api-v2";
let loadingPromise: Promise<void> | null = null;
let backendReady = false;
let modelsLoaded = false;
// Reuse a single offscreen canvas for pre-scaling video frames
let offscreenCanvas: HTMLCanvasElement | null = null;
let offscreenCtx: CanvasRenderingContext2D | null = null;

function getOffscreenCanvas(width: number, height: number) {
  if (!offscreenCanvas) {
    offscreenCanvas = document.createElement("canvas");
    offscreenCtx = offscreenCanvas.getContext("2d");
  }
  if (offscreenCanvas.width !== width || offscreenCanvas.height !== height) {
    offscreenCanvas.width = width;
    offscreenCanvas.height = height;
  }
  return { canvas: offscreenCanvas, ctx: offscreenCtx! };
}

async function ensureBackend() {
  if (backendReady) return;
  // Try WebGL first (GPU — much faster than CPU), then fall back
  for (const backend of ["webgl", "cpu"] as const) {
    try {
      await faceapi.tf.setBackend(backend);
      await faceapi.tf.ready();
      backendReady = true;
      return;
    } catch {
      // try next backend
    }
  }
  // Last resort: if TF initialised itself without us, carry on
  backendReady = true;
}

export function loadFaceModels(): Promise<void> {
  // If already loaded successfully, return immediately
  if (modelsLoaded) return Promise.resolve();
  // If loading in progress, return existing promise
  if (loadingPromise) return loadingPromise;

  loadingPromise = (async () => {
    await ensureBackend();
    await Promise.all([
      faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URL),
      faceapi.nets.faceLandmark68TinyNet.loadFromUri(MODEL_URL),
      faceapi.nets.faceRecognitionNet.loadFromUri(MODEL_URL),
    ]);
    modelsLoaded = true;
  })().catch((err) => {
    // Reset so retry is possible
    loadingPromise = null;
    throw err;
  });

  return loadingPromise;
}

export async function getDescriptorFromVideo(
  video: HTMLVideoElement
): Promise<{ descriptor: number[], ear: number } | null> {
  if (!modelsLoaded) {
    await loadFaceModels();
  }
  await ensureBackend();

  // Pre-scale the video to a small canvas to reduce inference cost.
  // Guard: video must have decoded dimensions before we can draw.
  const mobile = isMobileDevice();
  const scale = mobile ? 320 : 480;
  const vw = video.videoWidth || 0;
  const vh = video.videoHeight || 0;
  let source: HTMLVideoElement | HTMLCanvasElement = video;
  if (vw > 0 && vh > 0) {
    const w = scale;
    const h = Math.round((vh / vw) * scale) || scale;
    const { canvas, ctx } = getOffscreenCanvas(w, h);
    ctx.drawImage(video, 0, 0, w, h);
    source = canvas;
  }

  let detections;
  try {
    detections = await detectFaces(source);
  } catch (error) {
    console.error("Face detection error (retrying):", error);
    backendReady = false;
    await ensureBackend();
    try {
      detections = await detectFaces(source);
    } catch (fallbackError) {
      console.error("Face detection fallback also failed:", fallbackError);
      throw new Error("Face detection failed. Refresh the page and try again.");
    }
  }
  if (detections.length === 0) return null;
  if (detections.length > 1)
    throw new Error("Multiple faces detected. Scan one employee at a time.");
  
  const landmarks = detections[0].landmarks;
  const leftEye = landmarks.getLeftEye();
  const rightEye = landmarks.getRightEye();
  
  const calculateEAR = (eye: faceapi.Point[]) => {
    const v1 = euclidean([eye[1].x, eye[1].y], [eye[5].x, eye[5].y]);
    const v2 = euclidean([eye[2].x, eye[2].y], [eye[4].x, eye[4].y]);
    const h = euclidean([eye[0].x, eye[0].y], [eye[3].x, eye[3].y]);
    return (v1 + v2) / (2.0 * h);
  };

  const ear = (calculateEAR(leftEye) + calculateEAR(rightEye)) / 2.0;

  return { descriptor: Array.from(detections[0].descriptor), ear };
}

function detectFaces(source: HTMLVideoElement | HTMLCanvasElement) {
  const mobile = isMobileDevice();
  const options = new faceapi.TinyFaceDetectorOptions({
    inputSize: mobile ? 128 : 160,
    scoreThreshold: mobile ? 0.45 : 0.5,
  });

  return faceapi.detectAllFaces(source, options).withFaceLandmarks(true).withFaceDescriptors();
}

function isMobileDevice() {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent.toLowerCase();
  return /android|iphone|ipad|ipod|mobile/.test(ua) || navigator.hardwareConcurrency <= 4;
}

export function euclidean(a: number[], b: number[]): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += (a[i] - b[i]) ** 2;
  return Math.sqrt(s);
}

// Lower = more similar. Keep strict to reduce false matches between employees.
export const MATCH_THRESHOLD = 0.48;
export const MIN_MATCH_GAP = 0.06;
