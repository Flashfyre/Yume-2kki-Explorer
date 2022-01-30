const ConnType = {
    ONE_WAY: 1,
    NO_ENTRY: 2,
    UNLOCK: 4,
    LOCKED: 8,
    DEAD_END: 16,
    ISOLATED: 32,
    EFFECT: 64,
    CHANCE: 128,
    LOCKED_CONDITION: 256,
    SHORTCUT: 512,
    EXIT_POINT: 1024,
    SEASONAL: 2048,
    INACCESSIBLE: 4096
};

if (typeof exports === "object")
    module.exports = {
        ConnType
    };