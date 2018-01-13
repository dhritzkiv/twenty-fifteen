"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const fs = require("fs");
const assert = require("assert");
const minimist = require("minimist");
const simple_statistics_1 = require("simple-statistics");
const moment = require("moment");
const strava_activities_1 = require("./strava-activities");
const utils_1 = require("./utils");
const interpolateLineRange = require("line-interpolate-points");
/// <reference path="./haversine.d.ts"/>
const haversine = require("haversine");
const simplify = require("simplify-js");
class NumberArray extends Array {
}
class NumberMap extends Map {
    constructor(entries) {
        super(entries);
    }
}
const TOLERANCE = 0.001;
const filterByGreaterDateOrGreaterIndexPosition = (rideA, rides) => (rideB, index) => {
    /*if (rideB.start_date_local_date) {
        return rideB.start_date_local_date > rideA.start_date_local_date;
    } else {*/
    return index > rides.indexOf(rideA);
    //}
};
const distanceDiffForTwoPaths = (a, b) => a
    .map((aPoint, index) => [aPoint, b[index]])
    .map(([[x1, y1], [x2, y2]], index, array) => {
    //calculate the difference between the points
    let diff = Math.hypot(x1 - x2, y1 - y2);
    //calculate the alpha along the line
    let alpha = index / array.length;
    //alpha is lower towards the ends of the line
    alpha = Math.min(alpha, 1 - alpha);
    return diff * (2 + alpha);
})
    .reduce((total, distance) => total + distance, 0);
const isWeekend = (date) => date.getUTCDay() === 0 || date.getUTCDay() === 6;
//const addValues = (a: number, b: number) => a + b;
const mapToValue = (ride) => ride.distance;
const calculateStreaksForData = (data) => {
    let streakDays = 0;
    let streakRides = 0;
    let drySpell = 0;
    let maxStreakDays = 0;
    let maxStreakRides = 0;
    let maxDrySpell = 0;
    data
        .forEach(value => {
        if (value !== 0) {
            drySpell = 0;
            streakDays++;
            streakRides += value;
        }
        else {
            drySpell++;
            streakDays = 0;
            streakRides = 0;
        }
        maxStreakDays = Math.max(maxStreakDays, streakDays);
        maxStreakRides = Math.max(maxStreakRides, streakRides);
        maxDrySpell = Math.max(maxDrySpell, drySpell);
    });
    return {
        maxStreakDays,
        maxStreakRides,
        maxDrySpell
    };
};
const { _: [inFile, outFile] } = minimist(process.argv.slice(2));
assert.ok(inFile, "Missing input file argument");
const raw = fs.readFileSync(inFile, "utf8");
const data = JSON.parse(raw);
assert.ok(Array.isArray(data), "Data is not an array");
const rides = data.map(d => new strava_activities_1.Ride(d));
rides.sort(({ start_date_local_date: a }, { start_date_local_date: b }) => Number(a) - Number(b));
const startYear = rides[0].start_date_local_date.getFullYear();
const endYear = rides[rides.length - 1].start_date_local_date.getFullYear() + 1;
const startTime = moment(rides[0].start_date_local_date).startOf("year").toDate();
const endTime = moment(rides[rides.length - 1].start_date_local_date).endOf("year").toDate();
const daysInYear = moment(endTime).diff(moment(startTime), "days");
const dailyRidesMap = new Map();
const dailyRideCountsMap = new utils_1.IncrementalMap();
const dailyRideDistancesMap = new utils_1.IncrementalMap();
for (let i = 1; i <= daysInYear; i++) {
    if (moment(startTime).dayOfYear(i).isAfter(new Date())) {
        break;
    }
    dailyRideCountsMap.set(i, 0);
    dailyRideDistancesMap.set(i, 0);
}
rides.forEach(ride => {
    const dayOfYear = moment(ride.start_date_local_date).dayOfYear();
    const rideDay = dailyRidesMap.get(dayOfYear) || {
        date: moment(ride.start_date_local_date).startOf("day").toDate(),
        rides: []
    };
    rideDay.rides.push(ride);
    dailyRideCountsMap.increment(dayOfYear);
    dailyRideDistancesMap.increment(dayOfYear, ride.distance);
    dailyRidesMap.set(dayOfYear, rideDay);
});
const ridesByDayArray = [...dailyRidesMap.values()].map(({ rides }) => rides).sort(({ length: a }, { length: b }) => b - a);
const dailyRideCounts = [...dailyRideCountsMap.values()].sort((a, b) => b - a);
const dailyRideCountsDense = dailyRideCounts.filter(d => d);
const dailyRideDistances = [...dailyRideDistancesMap.values()].sort((a, b) => b - a);
const dailyRideDistancesDense = dailyRideDistances.filter(d => d);
const weekdayRides = rides.filter(({ start_date_local_date: date }) => !isWeekend(date));
const weekendRides = rides.filter(({ start_date_local_date: date }) => isWeekend(date));
const dayValues = rides.map(mapToValue);
const weekdayValues = weekdayRides.map(mapToValue);
const weekendValues = weekendRides.map(mapToValue);
const ridesWithMaps = rides.filter(({ map }) => map);
console.time("find dupes");
ridesWithMaps.forEach(ride => ride.mapline_interop = simplify(ride.mapline.map(([x, y]) => ({ x, y })), TOLERANCE, true).map(({ x, y }) => [x, y]));
//find a median point count for use in interpolation
const medianPointCount = simple_statistics_1.median(ridesWithMaps.map(ride => ride.mapline_interop.length));
//interpolate maps to use same # of points
ridesWithMaps.forEach((ride) => ride.mapline_interop = interpolateLineRange(ride.mapline_interop, medianPointCount));
const dupesMap = new Map();
//finds related rides
ridesWithMaps
    .map(ride => ({
    ride,
    diff: Math.abs(medianPointCount - ride.mapline_interop.length)
}))
    .sort(({ diff: a }, { diff: b }) => a - b)
    .map(({ ride }) => ride)
    .forEach((rideA, i, rides) => {
    const { mapline_interop: pathA } = rideA;
    const pathAReversed = pathA.slice(0).reverse();
    const dupeMapASet = dupesMap.get(rideA) || new Set();
    dupesMap.set(rideA, dupeMapASet);
    rides
        .filter(rideB => rideA !== rideB)
        .filter((rideB, index) => index > rides.indexOf(rideA))
        .forEach(rideB => {
        const { mapline_interop: pathB } = rideB;
        const dupeMapBSet = dupesMap.get(rideB) || new Set();
        dupesMap.set(rideB, dupeMapBSet);
        const distanceDiffs = [pathA, pathAReversed]
            .map(path => distanceDiffForTwoPaths(path, pathB))
            .map(diff => diff / medianPointCount);
        if (Math.min(...distanceDiffs) <= TOLERANCE) {
            dupeMapASet.add(rideB);
            dupeMapBSet.add(rideA);
        }
    });
});
console.timeEnd("find dupes");
console.time("prune dupes");
console.log("rides before de-duping", dupesMap.size);
for (const [parentRide, parentRelatedRides] of dupesMap) {
    const recursiveMergeAndDeleteRelatedRide = (relatedRides) => {
        for (const relatedRide of relatedRides) {
            const subrelatedRides = dupesMap.get(relatedRide);
            if (!subrelatedRides) {
                break;
            }
            subrelatedRides.delete(parentRide);
            for (const subrelatedRide of subrelatedRides) {
                parentRelatedRides.add(subrelatedRide);
                for (const _rides of dupesMap.values()) {
                    if (
                    //two sets are the same
                    _rides === relatedRides ||
                        _rides === parentRelatedRides ||
                        _rides === subrelatedRides) {
                        continue;
                    }
                    _rides.delete(subrelatedRide);
                    _rides.delete(relatedRide);
                    _rides.delete(parentRide);
                }
                recursiveMergeAndDeleteRelatedRide(subrelatedRides);
            }
            ;
            //dupesMap.delete(relatedRide);
            dupesMap.delete(relatedRide);
        }
    };
    recursiveMergeAndDeleteRelatedRide(parentRelatedRides);
}
console.log("rides after de-duping", dupesMap.size);
console.timeEnd("prune dupes");
const mostSimilarRides = [...dupesMap.entries()]
    .map(([ride, rides]) => ({ ride, count: rides.size }));
mostSimilarRides.sort(({ count: a }, { count: b }) => b - a);
console.log();
console.group("Top 10 similar rides");
mostSimilarRides.slice(0, 10)
    .map((entry, index) => [index + 1, entry.ride.id, entry.count])
    .forEach(line => console.log("%d: %s (%d)", ...line));
console.groupEnd();
if (outFile) {
    console.log();
    console.group("Output");
    const ridesArray = Array.from(dupesMap.keys()).map((ride) => ({
        id: ride.id,
        //correct the format from [lat, lon] to [lon, lat]
        points: ride.mapline.map(tuple => tuple.reverse())
    }));
    const reducePoints = (total, { points }) => total + points.length;
    const originalPointCount = ridesArray.reduce(reducePoints, 0);
    console.time("simplify rides");
    ridesArray.forEach((ride) => {
        ride.points = simplify(ride.points.map(([x, y]) => ({ x, y })), 0.0001, true).map(({ x, y }) => [x, y]);
    });
    console.timeEnd("simplify rides");
    const finalPointCount = ridesArray.reduce(reducePoints, 0);
    console.log(`simplified from ${originalPointCount} to ${finalPointCount} points`);
    fs.writeFileSync(outFile, JSON.stringify(ridesArray, null, "\t"));
    console.log("outputed file");
    console.groupEnd();
}
console.log();
console.group("Top speeds");
ridesWithMaps.sort(({ max_speed: a }, { max_speed: b }) => b - a)
    .slice(0, 20)
    .forEach((ride, index) => console.log("%d. ride %s top speed: %fkm/h", index + 1, ride.id, ride.max_speed * 3600 / 1000));
console.groupEnd();
const peakDistanceMap = new Map();
ridesWithMaps.forEach(ride => {
    let maxDistance = -Number.MAX_VALUE;
    const startingPoint = ride.mapline[0];
    ride.mapline
        .slice(1)
        .forEach((point) => {
        const distance = haversine(startingPoint, point, {
            format: "[lat,lon]",
            unit: "km"
        });
        if (distance > maxDistance) {
            maxDistance = distance;
        }
    });
    peakDistanceMap.set(ride, maxDistance);
});
const weeksMap = new utils_1.IncrementalMap();
const weeksDistanceMap = new utils_1.IncrementalMap();
const monthsMap = new utils_1.IncrementalMap();
const monthsDistanceMap = new utils_1.IncrementalMap();
const dayOfWeekMap = new utils_1.IncrementalMap();
const dayOfWeekDistanceMap = new utils_1.IncrementalMap();
const dayOfWeekCountMap = new utils_1.IncrementalMap();
rides.forEach(ride => {
    const dayOfWeekKey = moment(ride.start_date_local_date).format("dddd");
    //const dateKey = ride.start_date_local_date.toISOString().slice(0, 10);
    const weekKey = moment(ride.start_date_local_date).format("YYYY-w");
    const monthKey = ride.start_date_local_date.getMonth();
    dayOfWeekMap.increment(dayOfWeekKey);
    dayOfWeekDistanceMap.increment(dayOfWeekKey, ride.distance);
    weeksMap.increment(weekKey);
    weeksDistanceMap.increment(weekKey, ride.distance);
    monthsMap.increment(monthKey);
    monthsDistanceMap.increment(monthKey, ride.distance);
});
for (let i = 0; i < daysInYear; i++) {
    const day = moment(startTime).add(i, "days");
    const dayOfWeekKey = day.format("dddd");
    dayOfWeekCountMap.increment(dayOfWeekKey);
}
console.log();
console.group("Average rides per day of week");
[...dayOfWeekMap]
    .map(([day, count]) => [day, count / (dayOfWeekCountMap.get(day) || 1)])
    .sort(([, a], [, b]) => b - a)
    .forEach(([day, average]) => console.log(`${day}: ${average}`));
console.groupEnd();
console.log();
console.group("Average ride distance per day of week");
[...dayOfWeekDistanceMap]
    .map(([day, count]) => [day, count / (dayOfWeekCountMap.get(day) || 1)])
    .sort(([, a], [, b]) => b - a)
    .forEach(([day, average]) => console.log(`${day}: ${average / 1000}km`));
console.groupEnd();
console.log();
console.log("Rides by week:", [...weeksMap.values()]);
console.log("Distance by week:", [...weeksDistanceMap.values()].map(d => d / 1000));
console.log();
console.group("Rides by month");
[...monthsMap].forEach(([month, value]) => console.log(`${month}: ${value}`));
console.groupEnd();
console.group("Distance by month");
[...monthsDistanceMap].forEach(([month, value]) => console.log(`${month}: ${value / 1000}km`));
console.groupEnd();
console.log();
console.group("Top 10 rides by distance from start");
[...peakDistanceMap]
    .sort(([, a], [, b]) => b - a)
    .slice(0, 5)
    .forEach(([ride, distance], index) => console.log("%d. ride %s peak distance from start: %fkm", index + 1, ride.id, distance));
console.groupEnd();
const { maxStreakDays: totalMaxStreakDays, maxStreakRides: totalMaxStreakRides, maxDrySpell: totalMaxDrySpell } = calculateStreaksForData([...dailyRideCountsMap.values()]);
console.log();
console.group("Basic stats by rides");
console.log("total rides recorded: %d", rides.length);
console.log("manually enterred rides: %d", rides.filter(({ manual }) => manual).length);
console.log("mean daily rides", simple_statistics_1.mean(dailyRideCounts));
console.log("mean daily rides (dense)", simple_statistics_1.mean(dailyRideCountsDense));
console.log("median daily rides", simple_statistics_1.median(dailyRideCounts));
console.log("median daily rides (dense)", simple_statistics_1.median(dailyRideCountsDense));
console.log("total distance: %fkm", simple_statistics_1.sum(dailyRideDistancesDense) / 1000);
console.log("average daily distance (sparse): %fkm", simple_statistics_1.mean(dailyRideDistances) / 1000);
console.log("average daily distance: %fkm", simple_statistics_1.mean(dailyRideDistancesDense) / 1000);
console.log("total elevation gain: %fm", simple_statistics_1.sum(ridesWithMaps.map(ride => ride.total_elevation_gain)));
console.groupEnd();
console.log();
console.group("Basic stats by days");
console.log("most number of rides in a day: %d", ridesByDayArray[0].length);
console.log("number of days without a ride: %d", dailyRideCounts.filter(count => !count).length);
console.log("most distance in one day: %fkm", dailyRideDistances[0] / 1000);
console.log("least distance in one day (dense): %fkm", dailyRideDistancesDense.slice(-1).map(d => d / 1000)[0]);
const modeDailyRides = simple_statistics_1.modeFast(dailyRideCountsDense);
console.log("mode rides by day: %d", modeDailyRides);
console.log("days with more rides than usual: %d", dailyRideCounts.filter(count => count > modeDailyRides).length);
console.groupEnd();
console.log();
console.group("Streaks");
console.log("Most consectutive days with rides: %d", totalMaxStreakDays);
console.log("Most consectutive rides without a break day: %d", totalMaxStreakRides);
console.log("Longest no-ride streak in days: %d", totalMaxDrySpell);
console.groupEnd();
console.log();
console.group("Ride stats limits");
console.log("longest ride: %fkm", simple_statistics_1.max(rides.map(ride => ride.distance)) / 1000);
console.log("longest weekend ride: %fkm", simple_statistics_1.max(weekendRides.map(r => r.distance)) / 1000);
console.log("longest weekday ride: %fkm", simple_statistics_1.max(weekdayRides.map(r => r.distance)) / 1000);
console.log("shortest ride: %fkm", simple_statistics_1.min(rides.map(ride => ride.distance)) / 1000);
console.log("shortest weekend ride: %fkm", simple_statistics_1.min(weekendRides.map(r => r.distance)) / 1000);
console.log("shortest weekday ride: %fkm", simple_statistics_1.min(weekdayRides.map(r => r.distance)) / 1000);
console.groupEnd();
console.log();
console.group("Days by percentile");
console.log("median daily distance: %fkm", simple_statistics_1.median(dailyRideDistances) / 1000);
console.log("median daily distance (dense): %fkm", simple_statistics_1.median(dailyRideDistancesDense) / 1000);
console.log("75th percentile daily distance: %fkm", simple_statistics_1.quantile(dailyRideDistances, 0.75) / 1000);
console.log("75th percentile daily distance (dense): %fkm", simple_statistics_1.quantile(dailyRideDistancesDense, 0.75) / 1000);
console.log("90th percentile daily distance: %fkm", simple_statistics_1.quantile(dailyRideDistances, 0.90) / 1000);
console.log("90th percentile daily distance (dense): %fkm", simple_statistics_1.quantile(dailyRideDistancesDense, 0.90) / 1000);
console.log("95th percentile daily distance: %fkm", simple_statistics_1.quantile(dailyRideDistances, 0.95) / 1000);
console.log("95th percentile daily distance (dense): %fkm", simple_statistics_1.quantile(dailyRideDistancesDense, 0.95) / 1000);
console.log("99th percentile daily distance: %fkm", simple_statistics_1.quantile(dailyRideDistances, 0.99) / 1000);
console.log("99th percentile daily distance (dense): %fkm", simple_statistics_1.quantile(dailyRideDistancesDense, 0.99) / 1000);
console.groupEnd();
console.log();
console.group("Rides by percentile");
console.log("median ride: %fkm", simple_statistics_1.median(rides.map(ride => ride.distance)) / 1000);
console.log("75th percentile ride length: %fkm", simple_statistics_1.quantile(rides.map(ride => ride.distance), 0.75) / 1000);
console.log("90th percentile ride length: %fkm", simple_statistics_1.quantile(rides.map(ride => ride.distance), 0.90) / 1000);
console.log("95th percentile ride length: %fkm", simple_statistics_1.quantile(rides.map(ride => ride.distance), 0.95) / 1000);
console.log("99th percentile ride length: %fkm", simple_statistics_1.quantile(rides.map(ride => ride.distance), 0.99) / 1000);
console.groupEnd();
const rideDistancesInKilometres = rides.map(ride => ride.distance / 1000);
const numberOfRidesOverXKilometres = (min) => rideDistancesInKilometres.filter(d => d > min).length;
console.log();
console.group("Rides by distance groups");
console.log("# of rides over 5km: %d", numberOfRidesOverXKilometres(5));
console.log("# of rides over 10km: %d", numberOfRidesOverXKilometres(10));
console.log("# of rides over 25km: %d", numberOfRidesOverXKilometres(25));
console.log("# of rides over 50km: %d", numberOfRidesOverXKilometres(50));
console.log("# of rides over 75km: %d", numberOfRidesOverXKilometres(75));
console.log("# of rides over 100km: %d", numberOfRidesOverXKilometres(100));
console.groupEnd();
const rideDaysInKilometres = dailyRideDistances.map(d => d / 1000);
const numberOfDaysOverXKilometres = (min) => rideDaysInKilometres.filter(d => d > min).length;
console.log();
console.group("Days by distance groups");
console.log("# of days over 5km: %d", numberOfDaysOverXKilometres(5));
console.log("# of days over 10km: %d", numberOfDaysOverXKilometres(10));
console.log("# of days over 25km: %d", numberOfDaysOverXKilometres(25));
console.log("# of days over 50km: %d", numberOfDaysOverXKilometres(50));
console.log("# of days over 75km: %d", numberOfDaysOverXKilometres(75));
console.log("# of days over 100km: %d", numberOfDaysOverXKilometres(100));
console.log("Highest average speed: %fkm/h", simple_statistics_1.max(rides.map(({ average_speed }) => average_speed * 3600 / 1000)));
console.log("Lowest average speed: %fkm/h", simple_statistics_1.min(rides.map(({ average_speed }) => average_speed * 3600 / 1000)));
console.log("Median average speed: %fkm/h", simple_statistics_1.median(rides.map(({ average_speed }) => average_speed * 3600 / 1000)));
//# sourceMappingURL=rides.js.map