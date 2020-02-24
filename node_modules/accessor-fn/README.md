# Accessor function

A wrapper for property accessors supporting functions, property strings or constant values.

[![NPM](https://nodei.co/npm/accessor-fn.png?compact=true)](https://nodei.co/npm/accessor-fn/)

## Quick start

```
import accessorFn from 'accessor-fn';
```
or
```
var accessorFn = require('accessor-fn');
```
or even
```
<script src="//unpkg.com/accessor-fn"></script>
```

## Usage example

Given an object
```
var obj = {
    a: 1,
    b: 2
}
```

Use `accessorFn` to access object values via property strings or transformation functions:
```
var aFn = accessorFn('a');
aFn(obj); // 1

var sumFn = accessorFn(d => d.a + d.b);
sumFn(obj); // 3

var constantFn = accessorFn(7);
constantFn(obj); // 7
```