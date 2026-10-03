const Joi = require('joi');

const ruleSchema = Joi.object({
  code: Joi.string().required(),
  name: Joi.string().required(),
  category: Joi.string().valid('BEHAVIOR', 'IDENTITY', 'PAYMENT', 'DEVICE', 'ADDRESS', 'VELOCITY').required(),
  risk_points: Joi.number().integer().required(),
  evaluate: Joi.function().required(),
  description: Joi.function().required(),
});

const rulesArraySchema = Joi.array().items(ruleSchema).min(1);

function validateRules(rules) {
  const { error, value } = rulesArraySchema.validate(rules, { abortEarly: false });
  if (error) {
    throw new Error(`Invalid rules definition: ${error.message}`);
  }
  return value;
}

module.exports = {
  ruleSchema,
  rulesArraySchema,
  validateRules
};
