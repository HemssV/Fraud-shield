import pytest
from datetime import datetime
from ml.data.generate import ShipperState

def test_no_future_leakage():
    # Verify that computing features for row 2 does not use info from row 2 itself until update() is called
    s = ShipperState("S1", "Test")
    global_state = {'payments': {}, 'devices': {}}
    
    # Row 1
    dt1 = datetime(2026, 1, 1, 10, 0)
    r1 = {'device_id': 'D1', 'payment_id': 'P1', 'destination': 'CityA', 'origin': 'CityB', 'service_type': 'GROUND', 'weight': 10, 'package_count': 1}
    
    f1 = s.compute_features(r1, dt1, global_state)
    assert f1['identity']['is_new_device'] == False # since nothing is known yet, it falls back to empty set behavior
    
    s.update(r1, dt1)
    
    # Row 2 - same device, should NOT be new
    dt2 = datetime(2026, 1, 2, 10, 0)
    r2 = {'device_id': 'D1', 'payment_id': 'P1', 'destination': 'CityA', 'origin': 'CityB', 'service_type': 'GROUND', 'weight': 10, 'package_count': 1}
    
    f2 = s.compute_features(r2, dt2, global_state)
    assert f2['identity']['is_new_device'] == False
    
    # Row 3 - new device, should be true
    dt3 = datetime(2026, 1, 3, 10, 0)
    r3 = {'device_id': 'D2', 'payment_id': 'P1', 'destination': 'CityA', 'origin': 'CityB', 'service_type': 'GROUND', 'weight': 10, 'package_count': 1}
    
    f3 = s.compute_features(r3, dt3, global_state)
    assert f3['identity']['is_new_device'] == True
    
    # Update state with r3, now D2 is known
    s.update(r3, dt3)
    
    dt4 = datetime(2026, 1, 4, 10, 0)
    r4 = {'device_id': 'D2', 'payment_id': 'P1', 'destination': 'CityA', 'origin': 'CityB', 'service_type': 'GROUND', 'weight': 10, 'package_count': 1}
    f4 = s.compute_features(r4, dt4, global_state)
    assert f4['identity']['is_new_device'] == False
