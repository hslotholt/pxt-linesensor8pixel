function checkEqualArray(actual: number[], expected: number[]): string
{
    if (actual.length != expected.length) return "Length differs";
    for (let i = 0; i < actual.length; i++)
    {
        if (actual[i] != expected[i]) return "Value for index " + i + " differs";
    }
    return "";
}

function checkEqualArrays(actual: {a: number[], b: number[]}, expected: {a: number[], b: number[]}): string
{
    let str = checkEqualArray(actual.a, expected.a);
    if(str != "") return "Array 'a': " + str;
    str = checkEqualArray(actual.b, expected.b);
    if (str != "") return "Array 'b': " + str;
    return "";
}

function checkEqualNumber(actual: number, expected: number): string
{
    if(actual != expected) return("Expected: " + expected + " Actual: " + actual);
    return "";
}

function checkEqualTwoNumbers(actual: {a: number, b: number}, expected: {a: number, b: number}): string
{
    let str = checkEqualNumber(actual.a, expected.a);
    if(str != "") return "'a' differs: " + str;
    str = checkEqualNumber(actual.b, expected.b);
    if (str != "") return "'b' differs: " + str;
    return "";
}

function evaluate(result: string, name: string)
{
    if (result == "") serial.writeLine("Passed: " + name);
    else serial.writeLine("Failed: " + name + " : " + result);
}

let sortedTestData = [799, 214, 800, 199, 205, -100, 810, 200];
let sortedExpected = [-100, 199, 200, 205, 214, 799, 800, 810];
let sortedExpectedIndex = [5, 3, 7, 4, 1, 0, 2, 6];

/*
let sorted = LineSensor8Pixel.sortSensorData(sortedTestData);
let result = checkEqualArrays({a: sorted.sorted, b: sorted.sortedIndex}, {a: sortedExpected, b: sortedExpectedIndex});
evaluate(result, "sortSensorData");

let groupExpected2 = 1;
let groupExpected3 = 5;
let groups = LineSensor8Pixel.groupData(sortedExpected);
result = checkEqualTwoNumbers({a: groups.grp2Start, b: groups.grp3Start}, {a: groupExpected2, b: groupExpected3});
evaluate(result, "groupData");
*/