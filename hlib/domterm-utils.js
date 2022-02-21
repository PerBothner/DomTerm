export {toJson, fromJson };

function jsonReplacer(key, value) {
    if (value instanceof Map) {
        return { "%T": "Map", "$V": Array.from(value.entries()) };
    } else {
        return value;
    }
}

function jsonReviver(key, value) {
    if (typeof value === "object" && value !== null) {
        if (value["%T"] === "Map")
            return new Map(value["$V"]);
    }
    return value;
}

function toJson(value) {
    return JSON.stringify(value, jsonReplacer);
}

function fromJson(text) {
    return JSON.parse(text, jsonReviver);
}
