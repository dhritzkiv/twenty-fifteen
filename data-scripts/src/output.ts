import { execFile } from "child_process";
import { promisify } from "util";
import * as path from "path";

const asyncExecFile = promisify(execFile);

const DATA_SRC_DIR = path.resolve(__dirname, "../../data");
const DATA_DEST_DIR = path.resolve(__dirname, "../../client/public/data")
const SCRIPTS_DIR = __dirname;

const DEDUPED_SIMPLIFIED_RIDES = path.join(DATA_SRC_DIR, "2017_rides_deduped_simplified.json");

interface Area {
	name: string,
	boundary: [[number, number], [number, number]]
}

const areas: Area[] = [
	{
		name: "toronto",
		boundary: [
			[-81.0041, 42.6532],
			[-77.6944, 44.5221]
		]
	},
	{
		name: "montreal",
		boundary: [[-73.836769, 45.392057], [-73.454459, 45.671406]]
	},
	{
		name: "sydney",
		boundary: [[151.12094, -34.000247], [151.302217, -33.81795]]
	},
	{
		name: "melbourne",
		boundary: [[144.801803, -37.894592], [145.124183, -37.716918]]
	},
	{
		name: "auckland",
		boundary: [[174.670433, -36.963407], [174.910759, -36.788739]]
	},
	{
		name: "vancouver",
		boundary: [[-123.232761, 49.211834], [-123.022304, 49.332126]]
	}
];

const main = async () => {

	await asyncExecFile(`node`, [
		path.join(SCRIPTS_DIR, "rides.js"),
		path.join(DATA_SRC_DIR, "2017_rides.json"),
		DEDUPED_SIMPLIFIED_RIDES
	]);

	for (const area of areas) {
		await asyncExecFile(`node`, [
			path.join(SCRIPTS_DIR, "strava-rides-to-geojson.js"),
			DEDUPED_SIMPLIFIED_RIDES,
			path.join(DATA_DEST_DIR, `2017_rides_${area.name}.geojson`),
			`--boundary=${JSON.stringify(area.boundary)}`
		]);
	}
};

main();