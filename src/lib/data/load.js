import * as d3 from 'd3';
import { parseMajor, parseProgram, parseSchool } from './summarize.js';

/** Loads the cleaned files written by scripts/build_data.py (served from static/data). */
export async function loadData(base) {
	const url = (f) => `${base}/data/${f}`;
	const [schools, programs, majors, findings, meta] = await Promise.all([
		d3.csv(url('schools.csv'), parseSchool),
		d3.csv(url('programs.csv'), parseProgram),
		d3.csv(url('majors.csv'), parseMajor),
		d3.json(url('findings.json')),
		d3.json(url('meta.json'))
	]);
	return { schools, programs, majors, findings, meta };
}
