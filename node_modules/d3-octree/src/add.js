export default function(d) {
  var x = +this._x.call(null, d),
      y = +this._y.call(null, d),
      z = +this._z.call(null, d);
  return add(this.cover(x, y, z), x, y, z, d);
}

function add(tree, x, y, z, d) {
  if (isNaN(x) || isNaN(y) || isNaN(z)) return tree; // ignore invalid points

  var parent,
      node = tree._root,
      leaf = {data: d},
      x0 = tree._x0,
      y0 = tree._y0,
      z0 = tree._z0,
      x1 = tree._x1,
      y1 = tree._y1,
      z1 = tree._z1,
      xm,
      ym,
      zm,
      xp,
      yp,
      zp,
      right,
      bottom,
      deep,
      i,
      j;

  // If the tree is empty, initialize the root as a leaf.
  if (!node) return tree._root = leaf, tree;

  // Find the existing leaf for the new point, or add it.
  while (node.length) {
    if (right = x >= (xm = (x0 + x1) / 2)) x0 = xm; else x1 = xm;
    if (bottom = y >= (ym = (y0 + y1) / 2)) y0 = ym; else y1 = ym;
    if (deep = z >= (zm = (z0 + z1) / 2)) z0 = zm; else z1 = zm;
    if (parent = node, !(node = node[i = deep << 2 | bottom << 1 | right])) return parent[i] = leaf, tree;
  }

  // Is the new point is exactly coincident with the existing point?
  xp = +tree._x.call(null, node.data);
  yp = +tree._y.call(null, node.data);
  zp = +tree._z.call(null, node.data);
  if (x === xp && y === yp && z === zp) return leaf.next = node, parent ? parent[i] = leaf : tree._root = leaf, tree;

  // Otherwise, split the leaf node until the old and new point are separated.
  do {
    parent = parent ? parent[i] = new Array(8) : tree._root = new Array(8);
    if (right = x >= (xm = (x0 + x1) / 2)) x0 = xm; else x1 = xm;
    if (bottom = y >= (ym = (y0 + y1) / 2)) y0 = ym; else y1 = ym;
    if (deep = z >= (zm = (z0 + z1) / 2)) z0 = zm; else z1 = zm;
  } while ((i = deep << 2 | bottom << 1 | right) === (j = (zp >= zm) << 2 | (yp >= ym) << 1 | (xp >= xm)));
  return parent[j] = node, parent[i] = leaf, tree;
}

export function addAll(data) {
  var d, i, n = data.length,
      x,
      y,
      z,
      xz = new Array(n),
      yz = new Array(n),
      zz = new Array(n),
      x0 = Infinity,
      y0 = Infinity,
      z0 = Infinity,
      x1 = -Infinity,
      y1 = -Infinity,
      z1 = -Infinity;

  // Compute the points and their extent.
  for (i = 0; i < n; ++i) {
    if (isNaN(x = +this._x.call(null, d = data[i])) || isNaN(y = +this._y.call(null, d)) || isNaN(z = +this._z.call(null, d))) continue;
    xz[i] = x;
    yz[i] = y;
    zz[i] = z;
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (y < y0) y0 = y;
    if (y > y1) y1 = y;
    if (z < z0) z0 = z;
    if (z > z1) z1 = z;
  }

  // If there were no (valid) points, inherit the existing extent.
  if (x1 < x0) x0 = this._x0, x1 = this._x1;
  if (y1 < y0) y0 = this._y0, y1 = this._y1;
  if (z1 < z0) z0 = this._z0, z1 = this._z1;

  // Expand the tree to cover the new points.
  this.cover(x0, y0, z0).cover(x1, y1, z1);

  // Add the new points.
  for (i = 0; i < n; ++i) {
    add(this, xz[i], yz[i], zz[i], data[i]);
  }

  return this;
}
