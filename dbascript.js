var MeterLocations = {};
var nMeters = 0;
var logging = true;
var detailedlogging = true;
var MeterMarkerFeatures = new ol.Collection();
var xfeatures = [];
var DbaFetchPending = null;
var dBAFetchInterval = 1000;
var sdatetime = '';




var DisableBaseMap = false;
var CreateLegend = false; // if true, disables live updates and uses a legend-oriented meter list


if (CreateLegend) {
    var MeterLocationsJSON = "./data/meterlocations_legend.json"

} else {
    var MeterLocationsJSON = "./data/meterlocations.json"
}


if (DisableBaseMap) {

    // add blank base map
    if (logging) { console.log('Initializing base map') }
    var Mymap = new ol.Map({
        target: 'map',
        layers: [
            new ol.layer.Tile({
                source: null // set to 'null' for blank map
            })
        ],
        interactions: ol.interaction.defaults({
            doubleClickZoom: false,
            dragAndDrop: false,
            dragPan: true,
            keyboardPan: false,
            keyboardZoom: false,
            mouseWheelZoom: true,
            pointer: false,
            select: false
        }),
        controls: ol.control.defaults({
            attribution: true,
            zoom: false,
        }),
        view: new ol.View({
            center: ol.proj.fromLonLat([-89.336, 43.100]),
            zoom: 12.5,
            minZoom: 10,
            maxZoom: 14,
        })
    });
} else {
    // add base map
    if (logging) { console.log('Initializing base map') }
    var Mymap = new ol.Map({
        target: 'map',
        layers: [
            new ol.layer.Tile({
                source: new ol.source.OSM() // set to 'null' for blank map
            })
        ],
        interactions: ol.interaction.defaults({
            doubleClickZoom: false,
            dragAndDrop: false,
            dragPan: true,
            keyboardPan: false,
            keyboardZoom: false,
            mouseWheelZoom: true,
            pointer: false,
            select: false
        }),
        controls: ol.control.defaults({
            attribution: true,
            zoom: false,
        }),
        view: new ol.View({
            center: ol.proj.fromLonLat([-89.336, 43.100]),
            zoom: 12.5,
            minZoom: 10,
            maxZoom: 14,
        })
    });
}


var getDbaMarkerColor = function(feature) {
    const dBA = feature.get('dBA');
    const age = feature.get('age');
    const dBAdecade = Math.floor(dBA / 10);
    const dBAlastdigit = dBA % 10;
    let h = 0
    const s = "85%";
    const l = "50%";

    if (dBA < 30 || dBA > 130 || age < -10 || age > 10) {
        return [200, 200, 200]; // grey
    } else if (dBAdecade == 3) {
        h = 240 - dBAlastdigit / 10 * 40;
    } else if (dBAdecade == 4) {
        h = 200 - dBAlastdigit / 10 * 60;
    } else if (dBAdecade == 5) {
        h = 140 - dBAlastdigit / 10 * 60;
    } else if (dBAdecade == 6) {
        h = 80 - dBAlastdigit / 10 * 60;
    } else if (dBAdecade == 7) {
        h = 60 - dBAlastdigit / 10 * 20;
    } else if (dBAdecade == 8) {
        h = 40 - dBAlastdigit / 10 * 20;
    } else if (dBAdecade == 9) {
        h = 10 - dBAlastdigit / 10 * 30;
    } else if (dBAdecade > 9 && dBA <= 120) {
        h = 0;
    } else {
        return [200, 200, 200]; // grey    
    }

    return 'hsl(' + h + ',' + s + ',' + l + ')';
};

var MeterStyle = function(feature, resolution) {
    let dBA = feature.get('dBA');
    let markersize = 12.5;
    let markertext = feature.get('sdBA');
    let age = Math.abs(feature.get('age'));
    let textcolor = 'black';

    if (dBA < 40) {
        textcolor = 'white'; // use white text if <40dBA because black doesn't show up well
    }
    if (dBA >= 30 && dBA <= 130 && dBA != null && age < 10) {
        //size the marker according the dBA level
        markersize = dBA / 4;
    }

    if (age > 5) { textcolor = [255, 255, 255] } // white text if reading is more than 5 seconds out of synch
    if (age > 10) { markertext = "--" } // set display text to missing if out of synch by more than 10 seconds

    return new ol.style.Style({
        image: new ol.style.Circle({
            fill: new ol.style.Fill({
                color: getDbaMarkerColor(feature)
            }),
            stroke: new ol.style.Stroke({ color: 'black', width: 1 }),
            radius: markersize,
        }),
        text: new ol.style.Text({
            text: markertext,
            font: 'bold 15px "Open Sans", "Arial Unicode MS", "sans-serif"',
            placement: 'point',
            fill: new ol.style.Fill({ color: textcolor }),
        }),
    });
};

// Create Meters layer
var MeterLocationsLayer = new ol.layer.Vector({
    name: 'Meter Locations',
    type: 'overlay',
    title: 'Noise Meters',
    source: new ol.source.Vector({
        features: MeterMarkerFeatures,
    }),
    style: MeterStyle
});

Mymap.addLayer(MeterLocationsLayer);

async function initMeterLocations() {
    if (logging) { console.log('Initializing Meter Locations layer'); }
    let resp = await fetch(MeterLocationsJSON);
    MeterLocations = await resp.json();
    for (m in MeterLocations) {
        let location = MeterLocations[m].location;
        let slocation = location.toString();
        const newfeature = new ol.Feature({
            geometry: new ol.geom.Point(ol.proj.fromLonLat([MeterLocations[m].lon, MeterLocations[m].lat])),
        });
        newfeature.setId(location);
        newfeature.set('Location', slocation);
        newfeature.set('Meter', null);
        newfeature.set('sdBA', '--');
        newfeature.set('dBA', null);
        newfeature.set('epoch', Date.now());
        newfeature.set('age', 99);
        MeterMarkerFeatures.push(newfeature);

    }

    nMeters = MeterMarkerFeatures.getLength();
    if (logging) { console.log('# of meters...', nMeters); }

}
initMeterLocations();

// function to update noise monitoring points with dBA data from Pi server
function updateDbaData() {
    if ((DbaFetchPending !== null && DbaFetchPending.state() == 'pending') || nMeters == 0) {
        // don't double up on fetches, let the last one resolve
        return;
    }
    if (logging) { console.log('Fetching dBA data...'); }
    DbaFetchPending = $.ajax({
        url: 'http://192.168.112:8080/dba.json',
        timeout: 5000,
    });

    DbaFetchPending.done(function(data) {
        let currtime = new Date();
        let currepoch = Math.round(Date.now() / 1e3);
        sdatetime = currtime.toDateString() + " " + currtime.toLocaleTimeString();
        document.getElementById("currtime").innerHTML = sdatetime;

        dBAdata = JSON.parse(data);

        if (detailedlogging) {
            console.log('     dBA data updated:  ', dBAdata);
        }



        //loop through meter locations
        for (let i = 0; i <= (nMeters - 1); i++) {
            let seen = false;
            //loop through dBA records
            for (const j in dBAdata) {
                //update values if seen in dBA records
                if (MeterMarkerFeatures.item(i).get('Location') == dBAdata[j].location) {
                    seen = true;
                    const newdBA = dBAdata[j].dba;
                    const snewdBA = newdBA.toString();
                    const epoch = dBAdata[j].epoch;
                    const age = currepoch - epoch;
                    MeterMarkerFeatures.item(i).set('dBA', newdBA);
                    MeterMarkerFeatures.item(i).set('sdBA', snewdBA);
                    MeterMarkerFeatures.item(i).set('epoch', currepoch);
                    MeterMarkerFeatures.item(i).set('age', age);

                }
            }
            // just update the age by 1 second if not seen
            if (!seen) {
                const age = Math.min(MeterMarkerFeatures.item(i).get('age') + 1, 99);
                MeterMarkerFeatures.item(i).set('age', age);
                if (detailedlogging) { console.log('     Not Seen: Location ', MeterMarkerFeatures.item(i).get('Location')); }
            }

        }

        for (const i in dBAdata) {
            const location = dBAdata[i].location;
            const newdBA = dBAdata[i].dba;
            const snewdBA = newdBA.toString();
            const epoch = dBAdata[i].epoch;
            const age = currepoch - epoch;
            for (let j = 0; j <= (nMeters - 1); j++) {
                if (MeterMarkerFeatures.item(j).get('Location') == location) {
                    MeterMarkerFeatures.item(j).set('dBA', newdBA);
                    MeterMarkerFeatures.item(j).set('sdBA', snewdBA);
                    MeterMarkerFeatures.item(j).set('epoch', currepoch);
                    MeterMarkerFeatures.item(j).set('age', age);
                }
            }
        }

    });

    DbaFetchPending.fail(function(jqxhr, status, error) {
        $("#update_error_detail").text("AJAX call failed (" + status + (error ? (": " + error) : "") + "). Maybe dump1090 is no longer running?");
        $("#update_error").css('display', 'block');
        console.log('dBA data request fail');
    });
}
updateDbaData();
window.setInterval(updateDbaData, dBAFetchInterval);