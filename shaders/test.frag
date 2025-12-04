#version 300 es
precision highp float;

// IMPORTANT: Most of the parameters are passed from render.js. You can always modify any of them.
// You can check how the buffers are constructed in SceneFlattener.js

// Screen resolution in pixels
uniform vec2  uResolution;

// Camera data
uniform vec3 uCameraPos;
uniform mat4 uCamWorldMatrix;

// Global material coefficients
uniform float uGlobalKa;
uniform float uGlobalKd;
uniform float uGlobalKs;
uniform float uGlobalKt;

// Scene data stored in a 2D RGBA32F texture
uniform sampler2D uSceneBuffer; // width = floatsPerRow/4, height = objectCount
uniform int       uObjectCount;     // number of objects (rows in texture)
uniform int       uFloatsPerRow; // floats per row (32-bit floats)
uniform int       uSceneTexWidth;   // texture width = ceil(floatsPerObject/4)
uniform int       uSceneTexHeight;  // texture height = objectCount
uniform sampler2D uTextures[8]; // up to 8 distince textures if needed 

// Light data arrays
// NOTE: not all fields are useful
uniform int   uNumLights;
uniform int   uLightType[16];
uniform vec3  uLightColor[16];
uniform vec3  uLightPos[16];
uniform vec3  uLightDir[16];
uniform float uLightRadius[16];
uniform float uLightPenumbra[16];
uniform float uLightAngle[16];
uniform float uLightWidth[16];
uniform float uLightHeight[16];

uniform int uMaxDepth; // maximum recursion depth for reflections 

// constants
const float EPSILON = 1e-3;
const float PI = 3.141592653589793;
const float HALF = 0.5;
const float HALF2 = HALF * HALF;
float INF = 1.0 / 0.0;

const int SHAPE_CUBE = 0;
const int SHAPE_CYLINDER = 1;
const int SHAPE_CONE = 2;
const int SHAPE_SPHERE = 3;


// TODO: This should be your output color, instead of gl_FragColor
out vec4 outColor;

/*********** Helper Functions **********/

// ----------------------------------------------
// fetchFloat: retrieve a single float from uSceneBuffer
// idx = index of that float within the object's flattened data
// row = which object (row index) to fetch from
float fetchFloat(int idx, int row) {
    // Calculate which texel (column) and channel (RGBA) to read
    int texelX  = idx / 4;          // one texel holds 4 floats
    int channel = idx - texelX * 4; // idx % 4

    // Fetch the texel once
    vec4 texel = texelFetch(uSceneBuffer, ivec2(texelX, row), 0);

    // Return the appropriate component
    if (channel == 0) return texel.r;
    if (channel == 1) return texel.g;
    if (channel == 2) return texel.b;
    return texel.a;
}

// ----------------------------------------------
// fetchWorldMatrix: reconstruct a 4×4 world transform matrix for object idx
// Each object stores 1 type float + 16 matrix floats + 12 material floats, total = uFloatsPerRow
mat4 fetchWorldMatrix(int idx) {
    mat4 M = mat4(1.0);

    // Base index in flattened array for this object
    int base = 1;
    // +1 skips the type code; next 16 floats are the world matrix in row-major order

    // Loop over rows and columns to assemble the mat4 (column-major in GLSL)
    for (int r = 0; r < 4; ++r) {
        for (int c = 0; c < 4; ++c) {
            float value = fetchFloat(base + r * 4 + c, idx);
            M[c][r] = value;
        }
    }
    return M;
}

// ----------------------------------------------
// Material struct to hold 12 floats of material data
struct Material {
    vec3 ambientColor;
    vec3 diffuseColor;
    vec3 specularColor;
    float shininess;
    float ior;
    float useTexture;
    vec2 repeatUV;
    float textureIndex;
    vec3 reflectiveColor;
};

// fetchMaterial: reconstruct the material attributes for object idx
Material fetchMaterial(int idx) {
    Material mat;

    // Base index for material data: skip type (1) + matrix (16)
    int base = 1 + 16;

    mat.ambientColor.r  = fetchFloat(base + 0,  idx);
    mat.ambientColor.g  = fetchFloat(base + 1,  idx);
    mat.ambientColor.b  = fetchFloat(base + 2,  idx);

    mat.diffuseColor.r  = fetchFloat(base + 3,  idx);
    mat.diffuseColor.g  = fetchFloat(base + 4,  idx);
    mat.diffuseColor.b  = fetchFloat(base + 5,  idx);

    mat.specularColor.r = fetchFloat(base + 6,  idx);
    mat.specularColor.g = fetchFloat(base + 7,  idx);
    mat.specularColor.b = fetchFloat(base + 8,  idx);

    mat.shininess       = fetchFloat(base + 9,  idx);
    mat.ior             = fetchFloat(base + 10, idx);

    mat.useTexture      = fetchFloat(base + 11, idx);
    mat.repeatUV.x      = fetchFloat(base + 12, idx);
    mat.repeatUV.y      = fetchFloat(base + 13, idx);
    mat.textureIndex    = fetchFloat(base + 14, idx);

    mat.reflectiveColor = vec3(
      fetchFloat(base + 15, idx),
      fetchFloat(base + 16, idx),
      fetchFloat(base + 17, idx)
    );

    return mat;
}

// ----------------------------------------------
// intersectSphere: ray-sphere intersection in object space
// Sphere is centered at origin with radius = 0.5
// ro and rd should be in object space
float intersectSphere(vec3 ro, vec3 rd) {
    // DONE: implement ray-sphere intersection
    // return -1.0;

    vec3 e = ro;
    vec3 d = rd;
    float A = dot(d, d);
    float B = 2.0 * dot(d, e);
    float C = dot(e, e) - HALF2;

    float discriminant = B * B - 4.0 * A * C;

    if (discriminant < 0.0) {
        return -1.0;
    } else {
        float sqrtD = sqrt(discriminant);
        float t1 = (-B + sqrtD) / (2.0 * A);
        float t2 = (-B - sqrtD) / (2.0 * A);

        if (t1 < 0.0 && t2 < 0.0) {
            return -1.0;
        } else if (t1 < 0.0) {
            return t2;
        } else if (t2 < 0.0) {
            return t1;
        } else {
            return min(t1, t2);
        }
    }
}

// ----------------------------------------------
// normalSphere: compute normal at intersection point in object space
vec3 normalSphere(vec3 hitPos) {
    // DONE: implement normal computation for sphere
    return normalize(hitPos);
}

// ----------------------------------------------
// intersectCube: ray-cube intersection in object space
// Cube is centered at origin with side length = 1
float intersectCube(vec3 ro, vec3 rd) {
    // TODO: implement ray-cube intersection
    // return -1.0;

    float txp = (HALF - ro.x) / rd.x;
    txp = (abs(ro.y + txp * rd.y) <= HALF && abs(ro.z + txp * rd.z) <= HALF) ? txp : -1.0;

    float txn = (-HALF - ro.x) / rd.x;
    txn = (abs(ro.y + txn * rd.y) <= HALF && abs(ro.z + txn * rd.z) <= HALF) ? txn : -1.0;

    float typ = (HALF - ro.y) / rd.y;
    typ = (abs(ro.x + typ * rd.x) <= HALF && abs(ro.z + typ * rd.z) <= HALF) ? typ : -1.0;

    float tyn = (-HALF - ro.y) / rd.y;
    tyn = (abs(ro.x + tyn * rd.x) <= HALF && abs(ro.z + tyn * rd.z) <= HALF) ? tyn : -1.0;

    float tzp = (HALF - ro.z) / rd.z;
    tzp = (abs(ro.x + tzp * rd.x) <= HALF && abs(ro.y + tzp * rd.y) <= HALF) ? tzp : -1.0;

    float tzn = (-HALF - ro.z) / rd.z;
    tzn = (abs(ro.x + tzn * rd.x) <= HALF && abs(ro.y + tzn * rd.y) <= HALF) ? tzn : -1.0;

    float t = INF;
    if (txp > 0.0) t = min(t, txp);
    if (txn > 0.0) t = min(t, txn);
    if (typ > 0.0) t = min(t, typ);
    if (tyn > 0.0) t = min(t, tyn);
    if (tzp > 0.0) t = min(t, tzp);
    if (tzn > 0.0) t = min(t, tzn);

    return (t == INF) ? -1.0 : t;
}

// ----------------------------------------------
// normalCube: compute normal at intersection point in object space
vec3 normalCube(vec3 hitPos) {
    // TODO: implement normal computation for cube
    vec3 n = vec3(0.0);

    if (abs(hitPos.x - HALF) < EPSILON)  n.x =  1.0;
    if (abs(hitPos.x + HALF) < EPSILON)  n.x = -1.0;
    if (abs(hitPos.y - HALF) < EPSILON)  n.y =  1.0;
    if (abs(hitPos.y + HALF) < EPSILON)  n.y = -1.0;
    if (abs(hitPos.z - HALF) < EPSILON)  n.z =  1.0;
    if (abs(hitPos.z + HALF) < EPSILON)  n.z = -1.0;

    return normalize(n);
}

// ----------------------------------------------
// intersectCylinder: ray-cylinder intersection in object space
float intersectCylinder(vec3 ro, vec3 rd) {
    // Cylinder is centered at origin, radius = 0.5, height = 1
    float ex = ro.x;
    float ey = ro.y;
    float ez = ro.z;
    float dx = rd.x;
    float dy = rd.y;
    float dz = rd.z;

    float tcaptop = INF;
    float tcapbottom = INF;
    float tbody = INF;

    // Body Check
    float A = dx * dx + dz * dz;
    float B = 2.0 * (ex * dx + ez * dz);
    float C = ex * ex + ez * ez - HALF2;

    float discriminant = B * B - 4.0 * A * C;
    if (discriminant < 0.0) {
        tbody = INF;
    } else {
        float sqrtD = sqrt(discriminant);
        float t1 = (-B + sqrtD) / (2.0 * A);
        float t2 = (-B - sqrtD) / (2.0 * A);

        if (t1 < 0.0 && t2 < 0.0) {
            tbody = INF;
        } else if (t1 < 0.0) {
            tbody = t2;
        } else if (t2 < 0.0) {
            tbody = t1;
        } else {
            tbody = min(t1, t2);
        }

        // Check y bounds
        float yAtT = ey + dy * tbody;
        if (yAtT > HALF || yAtT < -HALF) {
            tbody = INF;
        }
    }

    // Top cap check
    if (abs(dy) > EPSILON) {
        tcaptop = (HALF - ey) / dy;
        vec3 capPos = ro + rd * tcaptop;
        if (tcaptop > 0.0 && capPos.x * capPos.x + capPos.z * capPos.z <= HALF2) {
            // valid
        } else {
            tcaptop = INF;
        }
    }

    // Bottom cap check
    if (abs(dy) > EPSILON) {
        tcapbottom = (-HALF - ey) / dy;
        vec3 capPos = ro + rd * tcapbottom;
        if (tcapbottom > 0.0 && capPos.x * capPos.x + capPos.z * capPos.z <= HALF2) {
            // valid
        } else {
            tcapbottom = INF;
        }
    }

    float t = min(min(tcaptop, tcapbottom), tbody);
    return (t == INF) ? -1.0 : t;
}

// normalCylinder: compute normal at intersection point in object space
vec3 normalCylinder(vec3 hitPos) {
    // Cylinder is centered at origin, radius = 0.5, height = 1
    if (abs(hitPos.y - HALF) < EPSILON) {
        return vec3(0.0, 1.0, 0.0);
    } else if (abs(hitPos.y + HALF) < EPSILON) {
        return vec3(0.0, -1.0, 0.0);
    } else {
        return normalize(vec3(hitPos.x / HALF, 0.0, hitPos.z / HALF));
    }
}

// ----------------------------------------------
// intersectCone: ray-cone intersection in object space
float intersectCone(vec3 ro, vec3 rd) {
    float ex = ro.x;
    float ey = ro.y;
    float ez = ro.z;
    float dx = rd.x;
    float dy = rd.y;
    float dz = rd.z;

    float tbody = INF;
    float tcap = INF;

    // Body Check
    float A = dx * dx + dz * dz - HALF2 * dy * dy;
    float B = 2.0 * (ex * dx + ez * dz) - HALF * ey * dy + HALF2 * dy;
    float C = ex * ex + ez * ez - HALF2 * ey * ey + HALF2 * ey - (1.0 / 16.0);

    float discriminant = B * B - 4.0 * A * C;
    if (discriminant < 0.0) {
        tbody = INF;
    } else {
        float sqrtD = sqrt(discriminant);
        float t1 = (-B + sqrtD) / (2.0 * A);
        float t2 = (-B - sqrtD) / (2.0 * A);

        if (t1 < 0.0 && t2 < 0.0) {
            tbody = INF;
        } else if (t1 < 0.0) {
            tbody = t2;
        } else if (t2 < 0.0) {
            tbody = t1;
        } else {
            tbody = min(t1, t2);
        }

        // Check y bounds
        float yAtT = ey + dy * tbody;
        if (yAtT > HALF || yAtT < -HALF) {
            tbody = INF;
        }
    }

    // Bottom cap check
    if (abs(dy) > EPSILON) {
        tcap = (-HALF - ey) / dy;
        vec3 capPos = ro + rd * tcap;
        if (tcap > 0.0 && capPos.x * capPos.x + capPos.z * capPos.z <= HALF2) {
            // valid
        } else {
            tcap = INF;
        }
    }

    float t = min(tbody, tcap);
    return (t == INF) ? -1.0 : t;
}

// normalCone: compute normal at intersection point in object space
vec3 normalCone(vec3 hitPos) {
    if (abs(hitPos.y + HALF) < EPSILON) {
        return vec3(0.0, -1.0, 0.0);
    } else {
        return normalize(vec3(hitPos.x / HALF, HALF, hitPos.z / HALF));
    }
}


vec2 getTexCoordSphere(vec3 hit, vec2 repeatUV) {
    // TODO: implement spherical mapping
    return vec2(0.0);
}

vec2 getTexCoordCube(vec3 hit, vec3 dominantFace, vec2 repeatUV) {
    // TODO: implement cubic mapping
    return vec2(0.0);
}

vec2 getTexCoordCylinder(vec3 hit, vec2 repeatUV) {
    // TODO: implement cylindrical mapping
    return vec2(0.0);
}

vec2 getTexCoordCone(vec3 hit, vec2 repeatUV) {
    // TODO: implement conical mapping
    return vec2(0.0);
}


// ----------------------------------------------
// getWorldRayDir: reconstruct world-space ray direction using uCamWorldMatrix
vec3 getWorldRayDir() {
    vec2 uv  = gl_FragCoord.xy / uResolution; 
    // TODO: compute ray direction in world space
    uv = 2. * uv - 1.;
    vec3 uvworld = (uCamWorldMatrix * vec4(uv, -1.0, 1.0)).xyz;
    
    vec3 dir = uvworld - uCameraPos;
    return normalize(dir);
}

// to help test occlusion (shadow)
bool isInShadow(vec3 p, vec3 lightDir, float maxDist) {
    // TODO: implement shadow ray intersection test
    return false; 
}


//----------------------------------------------
// CUSTOM HELPER Functions
//----------------------------------------------

// funnel for intersecting different object types
float intersect(vec3 ro, vec3 rd, int idx) {
    int type = int(fetchFloat(0, idx));

    switch (type) {
        case SHAPE_CUBE: {
            float t = intersectCube(ro, rd);
            if (t != -1.0) return t;
            break;
        }
        case SHAPE_SPHERE: {
            float t = intersectSphere(ro, rd);
            if (t != -1.0) return t;
            break;
        }
        case SHAPE_CYLINDER: {
            float t = intersectCylinder(ro, rd);
            if (t != -1.0) return t;
            break;
        }
        case SHAPE_CONE: {
            float t = intersectCone(ro, rd);
            if (t != -1.0) return t;
            break;
        }
        default:
            break;
    }

    return INF;
}

// funnel for intersecting different object types
vec3 getNormal(vec3 hitPos, int idx) {
    int type = int(fetchFloat(0, idx));

    switch (type) {
        case SHAPE_CUBE: {
            return normalCube(hitPos);
        }
        case SHAPE_SPHERE: {
            return normalSphere(hitPos);
        }
        case SHAPE_CYLINDER: {
            return normalCylinder(hitPos);
        }
        case SHAPE_CONE: {
            return normalCone(hitPos);
        }
        default:
            break;
    }

    return vec3(0.0); 
}

// bounce = recursion level (0 for primary rays)
// end goal: trace a ray that bounces 5 times to determine color of pixel
vec3 traceRay(vec3 rayOrigin, vec3 rayDir) {
    // TODO: implement ray tracing logic

    // data to track closest object
    float t = INF;
    int objectID = -1;
    vec3 hitPosObj = vec3(0.0);
    
    // loop over each object to find closest
    for(int i = 0; i < uObjectCount; i++) {
        // get world to object matrix
        mat4 M = fetchWorldMatrix(i);
        mat4 worldToObjM = inverse(M);

        // transform ray
        vec3 ro = (worldToObjM * vec4(rayOrigin, 1.0)).xyz;
        vec3 rd = (worldToObjM * vec4(rayDir, 0.0)).xyz;

        // use intersect to get t
        float tempT = intersect(ro, rd, i); 

        // determine the object with the lowest positive t value
        if (tempT != -1.0 && tempT < t) { // this requires t to be positive.
            t = tempT;
            objectID = i;
            hitPosObj = rayOrigin + rayDir * t; 
        }
    }

    // If no intersection, return black
    if (t == INF || objectID == -1) {
        return vec3(0.0);
    }

    // Get the world matrix for this object
    mat4 worldMatrix = fetchWorldMatrix(objectID);
    mat4 objMatrix = inverse(worldMatrix);

    // Global material coefficients
    float ka = uGlobalKa;
    float kd = uGlobalKd;
    float ks = uGlobalKs;
    int   m  = uNumLights;

    // Get normal in object space
    vec3 normalObj = getNormal(hitPosObj, objectID);

    // Transform normal to world space (using transpose of inverse)
    mat4 normMatrix = transpose(objMatrix);
    vec3 nWorld = normalize((normMatrix * vec4(normalObj, 0.0)).xyz);
    
    // Transform hit position to world space
    vec3 pWorld = (worldMatrix * vec4(hitPosObj, 1.0)).xyz; // might need transpose
    
    // Get material properties
    Material mat = fetchMaterial(objectID);
    
    
    // Start with ambient color
    vec3 ambientColor = ka * mat.ambientColor;
    vec3 color = ambientColor; // color = (R, G, B)
    
    // Calculate view direction (from hit point to camera)
    vec3 viewDir = normalize(uCameraPos - pWorld); // lowkey just use rayDir?
    
    // Loop through all lights
    for (int i = 0; i < m; i++) {
        // Get light color and position
        vec3 lightColor = uLightColor[i];
        vec3 lightPos = uLightPos[i];
        
        // Calculate light direction (from hit point to light)
        vec3 lightDir = normalize(lightPos - pWorld);
        
        // Calculate reflection vector: R = 2(L·N)N - L
        // float nDotL = dot(nWorld, lightDir);
        // vec3 reflectDir = 2.0 * nDotL * nWorld - lightDir;
        vec3 reflectDir = lightDir - 2.0 * dot(lightDir, nWorld) * nWorld;
        
        // Calculate diffuse contribution
        // float diffuseFactor = max(0.0, nDotL); 
        // vec3 diffuseColor = kd * mat.diffuseColor * diffuseFactor;
        
        // Calculate specular contribution
        // float specularFactor = max(0.0, dot(reflectDir, viewDir));
        // float specularPower = pow(specularFactor, mat.shininess);
        // vec3 specularColor = ks * mat.specularColor * specularPower;


        //nate attempt // might need to factor in shadows later
        vec3 diffuse = lightColor * (kd * mat.diffuseColor * dot(nWorld, lightDir));
        vec3 specular = ks * mat.specularColor * pow(dot(reflectDir, viewDir), mat.shininess);
        color += diffuse + specular;
        
        // Add light contribution
        // color += lightColor * (diffuseColor + specularColor);
    }
    
    // Clamp color values to [0, 1] range
    return color;
}


// ----------------------------------------------
// main: iterate over all objects, test intersection, and shade
void main() {
    // Compute ray origin and direction in world space
    vec3 rayOrigin = uCameraPos;
    vec3 rayDir    = getWorldRayDir();

    // process and get final color 
    vec3 color = traceRay(rayOrigin, rayDir);
    outColor = vec4(color, 1.0);
}