const createDOMPurify = require('dompurify');
const { JSDOM } = require('jsdom');
const xss = require('xss');


const window = new JSDOM('').window;
const DOMPurify = createDOMPurify(window);


exports.cleanHtml = (input='') => DOMPurify.sanitize(input, { ALLOWED_TAGS: ['b','i','u','br','strong','em','p','ul','ol','li'] });
exports.cleanText = (input='') => xss(String(input), { whiteList: {}, stripIgnoreTag: true, stripIgnoreTagBody: ['script'] });