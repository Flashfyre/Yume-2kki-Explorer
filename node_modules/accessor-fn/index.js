export default p => p instanceof Function
    ? p                     // fn
    : typeof p === 'string'
        ? obj => obj[p]     // property name
        : obj => p;         // constant
