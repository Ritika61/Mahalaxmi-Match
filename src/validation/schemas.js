const Joi = require('joi');

const name = Joi.string().trim().min(2).max(100);
const email = Joi.string().email({ tlds: false }).max(255);
const phone = Joi.string().trim().min(5).max(64);
const country = Joi.string().trim().min(2).max(100);

exports.inquirySchema = Joi.object({
  profile: Joi.string().valid('Distributor','Retailer','Consumer','Supplier','Other').required(),
  interest: Joi.string().valid(
    'Ask for a quotation','Become a partner','Product feedback','Where can I find your products',
    'Become a supplier','Get in contact with the right person','Other'
  ).required(),
  product_hint: Joi.string().allow(null,'').max(64),
  est_annual_volume: Joi.string().allow(null,'').max(64),
  business_website: Joi.string().uri().allow(null,''),
  supplier_tags: Joi.string().allow(null,'').max(255),
  first_name: name.required(),
  last_name: name.required(),
  email: email.required(),
  phone: phone.required(),
  country: country.required(),
  message: Joi.string().allow('', null).max(5000),
  consent: Joi.boolean()
});
