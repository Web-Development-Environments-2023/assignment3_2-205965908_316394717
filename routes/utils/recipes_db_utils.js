const RecipeDto = require("../dto/RecipeDto");
const Instruction = require("../dto/Instruction");
const InstructionSet = require("../dto/InstructionSet");
const Ingredient = require("../dto/Ingredient");
const Equipment = require("../dto/Equipment");

const DButils = require("./DButils");

async function addRecipe(user_id, recipe) {
    try {
        let queries = [];
        queries.push(`INSERT INTO recipes
                      VALUES (0, ${user_id}, '${recipe.title}', ${recipe.readyInMinutes}, ${recipe.vegetarian},
                              ${recipe.vegan}, ${recipe.glutenFree}, ${recipe.servings}, '${recipe.image}')`);
        queries.push("SELECT @newId:=MAX(id) FROM recipes");

        if (recipe.inventedBy && recipe.serveDay) {
            queries.push(`INSERT INTO family_recipe
                          VALUES (@newId, '${recipe.inventedBy}', '${recipe.serveDay}')`);
        }
        for (const instruction of recipe.instructions) {
            queries.push(`INSERT INTO instructions
                          VALUES (@newId, ${instruction.number}, '${instruction.step}')`);
            for (const equipment of instruction.equipments) {
                queries.push(`INSERT INTO instructions_equipments
                              VALUES (${equipment.id}, @newId, ${instruction.number})`);
            }
            for (const ingredient of instruction.ingredients) {
                queries.push(`INSERT INTO instructions_ingredients
                              VALUES (${ingredient.id}, @newId, ${instruction.number}, ${ingredient.amount},
                                      '${ingredient.amountType}')`);
            }
        }

        await DButils.execMultiQuery(queries);
    } catch (e) {
        console.log(e.sqlMessage);
        throw e;
    }
}

async function getMyRecipes(user_id, skip = 0, limit = 10, family = false) {
    let query_select_my_recipes = `SELECT *
                                   FROM (SELECT * FROM recipes WHERE user_id = '${user_id}') a
                                            LEFT JOIN family_recipe b ON a.id = b.recipe_id
                                   WHERE b.recipe_id IS ${family ? "NOT" : ""} NULL
                                   LIMIT ${limit} OFFSET ${skip}`;
    let recipes = await DButils.execQuery(query_select_my_recipes);
    return recipes.map((x) => convertToRecipePreview(x));
}

async function getMyRecipesCount(user_id, family = false) {
    let query_select_my_recipes = `SELECT COUNT(*) as num
                                   FROM (SELECT * FROM recipes WHERE user_id = '${user_id}') a
                                            LEFT JOIN family_recipe b ON a.id = b.recipe_id
                                   WHERE b.recipe_id IS ${family ? "NOT" : ""} NULL`;
    return (await DButils.execQuery(query_select_my_recipes))[0].num;
}

async function getMySpecificRecipe(user_id, recipe_id) {
    let query_select_my_recipes = `SELECT *
                                   FROM recipes a
                                            LEFT JOIN family_recipe b ON a.id = b.recipe_id
                                   WHERE user_id = '${user_id}'
                                     AND id = ${recipe_id}`;
    let recipeDbData = await DButils.execQuery(query_select_my_recipes);
    if (recipeDbData.length === 0) return undefined;
    let recipe = recipeDbData[0];

    // get equipments
    let query_select_instruction_equipments = `SELECT a.number,
                                                      a.step,
                                                      c.id         as equipment_id,
                                                      c.name       as equipment_name,
                                                      c.image_path as equipment_image
                                               FROM (SELECT * FROM instructions WHERE recipe_id = ${recipe.id}) a
                                                        LEFT JOIN instructions_equipments b
                                                                  ON a.recipe_id = b.recipe_id AND a.number = b.number
                                                        JOIN equipments c
                                                             ON b.equipment_id = c.id`;
    let equipments_db = await DButils.execQuery(query_select_instruction_equipments);

    // get ingredients
    let query_select_instruction_ingredients = `SELECT a.number,
                                                       a.step,
                                                       b.amount,
                                                       b.amount_type,
                                                       c.id         as ingredient_id,
                                                       c.name       as ingredient_name,
                                                       c.image_path as ingredient_image
                                                FROM (SELECT * FROM instructions WHERE recipe_id = ${recipe.id}) a
                                                         LEFT JOIN instructions_ingredients b
                                                                   ON a.recipe_id = b.recipe_id AND a.number = b.number
                                                         JOIN ingredients c
                                                              ON b.ingredient_id = c.id;`;
    let ingredients_db = await DButils.execQuery(query_select_instruction_ingredients);
    ///////
    // get all unique numbers
    const numbers_and_steps = new Set();
    let select_number_and_step = `SELECT number, step
                                  FROM instructions
                                  WHERE recipe_id = ${recipe.id}`;
    let number_step_data = await DButils.execQuery(select_number_and_step);
    number_step_data.forEach((row) => {
        numbers_and_steps.add([row.number, row.step]);
    });

    let instructions = [];
    numbers_and_steps.forEach((num_and_step) => {
        const num = num_and_step[0];
        let equipments = [];
        equipments_db.forEach((equipment) => {
            if (equipment.number === num) {
                equipments.push(new Equipment(equipment.equipment_id, equipment.equipment_name, equipment.equipment_image));
            }
        });
        let ingredients = [];
        ingredients_db.forEach((ingredient) => {
            if (ingredient.number === num) {
                ingredients.push(new Ingredient(ingredient.ingredient_id, ingredient.ingredient_name, ingredient.amount, ingredient.amount_type, ingredient.ingredient_image));
            }
        });
        instructions.push(new Instruction(equipments, ingredients, num_and_step[0], num_and_step[1]));
    });

    let ingredients = {};
    instructions.forEach(instruction => {
        instruction.ingredients.forEach(ingredient => {
            let key = `${ingredient.id}-${ingredient.amountType}`;
            if (!ingredients[key]) {
                ingredients[key] =
                    {
                        id: ingredient.id,
                        name: ingredient.name,
                        amount: 0,
                        amountType: ingredient.amountType,
                        image: ingredient.image
                    };
            }
            ingredients[key].amount += ingredient.amount;
        });
    });
    ingredients = Object.values(ingredients);

    let equipments = {};
    instructions.forEach(instruction => {
        instruction.equipments.forEach(equipment => {
            equipments[equipment.id] =
                {
                    id: equipment.id,
                    name: equipment.name,
                    image: equipment.image
                };
        });
    });
    equipments = Object.values(equipments);


    return new RecipeDto(recipe.id, recipe.title, recipe.ready_in_minutes, 0, recipe.vegetarian,
        recipe.vegan, recipe.gluten_free, true, false, recipe.image_path,
        recipe.invented_by, recipe.serve_day, recipe.servings, ingredients, equipments, [new InstructionSet("", instructions)]);
}

function convertToRecipePreview(recipe) {
    let {
        id,
        title,
        ready_in_minutes,
        image_path,
        vegan,
        vegetarian,
        gluten_free,
    } = recipe;

    return {
        id: id,
        title: title,
        readyInMinutes: ready_in_minutes,
        image: image_path,
        popularity: 0,
        vegan: vegan === 1,
        vegetarian: vegetarian === 1,
        glutenFree: gluten_free === 1,
        hasViewed: true,
        isFavorite: false
    };
}

exports.addRecipe = addRecipe;
exports.getMySpecificRecipe = getMySpecificRecipe;
exports.getMyRecipesCount = getMyRecipesCount;
exports.getMyRecipes = getMyRecipes;
