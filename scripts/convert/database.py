import logging
import os
import peewee
import shelve
import sys

logger: logging.Logger = logging.getLogger('PlanarAllyServer')
logger.setLevel(logging.INFO)
formatter = logging.Formatter(
    '%(asctime)s - %(levelname)s - %(message)s (%(filename)s:%(lineno)d)')
streamHandler = logging.StreamHandler(sys.stdout)
streamHandler.setFormatter(formatter)
logger.addHandler(streamHandler)

sys.path.insert(0, os.getcwd())
try:
    import planarally_old as planarally
    import auth
    from models import db, ALL_MODELS, Asset, Aura, Layer, Location, LocationUserOption, Room, PlayerRoom, Shape, ShapeOwner, Tracker, User, UserOption
    from config import SAVE_FILE
except ImportError:
    logger.warning(
        "You have to run this script from within the same folder as the save file.")
    logger.info("E.g.: python ../scripts/convert/database.py")
    sys.exit(2)


def add_assets(user, data, parent=None):
    if not isinstance(data, dict):
        return
    for folder in data.keys():
        if folder == '__files':
            for file_ in data['__files']:
                Asset.create(owner=user, parent=parent, name=file_['name'], file_hash=file_['hash'])
        else:
            db_asset = Asset.create(owner=user, parent=parent, name=folder)
            add_assets(user, data[folder], parent=db_asset)


def convert(save_file):
    if os.path.exists(SAVE_FILE):
        logger.warning("Database already exists.  Abort conversion.")
        sys.exit(2)
    logger.info("Creating tables")
    db.create_tables(ALL_MODELS)
    
    with shelve.open(save_file, "c") as shelf:
        logger.info("Creating users")
        with db.atomic():
            for user in shelf['user_map'].values():
                logger.info(f"\tUser {user.username}")
                db_user = User.create(username=user.username,
                            password_hash=user.password_hash)
                
                db_user_option = UserOption.create(user=db_user)
                for option in [('fowColour', 'fow_colour'), ('gridColour', 'grid_colour'), ('rulerColour', 'ruler_colour')]:
                    if option[0] in user.options:
                        setattr(db_user_option, option[1], user.options[option[0]])
                db_user_option.save()

                add_assets(db_user, user.asset_info)

        logger.info("Creating rooms")
        with db.atomic():
            for room in shelf['rooms'].values():
                logger.info(f"\tRoom {room.name}")
                user = User.get_or_none(User.username == room.creator)
                if user is None:
                    logger.error(
                        f"/Room {room.name} creator {room.creator} does not appear in the user map.")
                    sys.exit(2)
                db_room = Room.create(name=room.name, creator=user, invitation_code=room.invitation_code,
                                      player_location=room.player_location, dm_location=room.dm_location)

                logger.info("\t\tPlayerRoom")
                for player_name in room.players:
                    player = User.get_or_none(User.username == player_name)
                    if player is None:
                        logger.error(
                            f"/Room {room.name} player {player_name} does not appear in the user map.")
                        sys.exit(2)
                    PlayerRoom.create(player=player, room=db_room)

                for location in room.locations.values():
                    logger.info(f"\t\tLocation {location.name}")
                    db_location = Location.create(
                        room=db_room, name=location.name)

                    for i_l, layer in enumerate(location.layer_manager.layers):
                        db_layer = Layer.create(location=db_location, name=layer.name, player_visible=layer.player_visible,
                                                player_editable=layer.player_editable, selectable=layer.selectable, index=i_l)

                        for i_s, shape in enumerate(layer.shapes.values()):
                            db_shape = Shape(
                                uuid=shape['uuid'], layer=db_layer, x=shape['x'], y=shape['y'], name=shape.get('name'), index=i_s)
                            for optional in [('border', 'border_colour'), ('fill', 'fill_colour'), ('isToken', 'is_token'), ('globalCompositeOperation', 'draw_operator'), ('annotation', 'annotation'), ('movementObstruction', 'movement_obstruction'), ('visionObstruction', 'vision_obstruction')]:
                                if shape.get(optional[0]):
                                    setattr(
                                        db_shape, optional[1], shape[optional[0]])
                            db_shape.save(force_insert=True)
                            
                            for tracker in shape.get('trackers', []):
                                if tracker['value'] == '':
                                    tracker['value'] = 0
                                if tracker['maxvalue'] == '':
                                    tracker['maxvalue'] = 0
                                Tracker.create(
                                    uuid=tracker['uuid'],
                                    shape=db_shape,
                                    visible=tracker['visible'],
                                    name=tracker['name'],
                                    value=tracker['value'],
                                    maxvalue=tracker['maxvalue'])
                            
                            for aura in shape.get('auras', []):
                                if aura['value'] == '':
                                    aura['value'] = 0
                                if aura['dim'] == '' or aura['dim'] is None:
                                    aura['dim'] = 0
                                Aura.create(
                                    uuid=aura['uuid'],
                                    shape=db_shape,
                                    light_source=aura['lightSource'],
                                    visible=aura['visible'],
                                    name=aura['name'],
                                    value=aura['value'],
                                    dim=aura['dim'],
                                    colour=aura['colour'])
                            
                            for owner in shape.get('owners', []):
                                if owner == '': continue
                                db_owner = User.get_or_none(User.username == owner)
                                if db_owner is None:
                                    continue
                                ShapeOwner.create(shape=db_shape, user=db_owner)
        
        logger.info("User-Location options")
        for user in shelf['user_map'].values():
            db_user = User.get(username=user.username)
            for location_option in user.options.get('locationOptions', []):
                room, creator, location = location_option.split("/")
                db_location = Location.select().join(Room).join(User).where((User.username == creator) & (Room.name == room) & (Location.name == location)).first()
                if db_location is None:
                    continue
                db_user_location_option = LocationUserOption.create(location=db_location, user=db_user)
                for option in [('panX', 'pan_x'), ('panY', 'pan_y'), ('zoomFactor', 'zoom_factor')]:
                    if option[0] in user.options['locationOptions'][location_option]:
                        setattr(db_user_location_option, option[1], user.options['locationOptions'][location_option][option[0]])
                db_user_location_option.save()

        logger.info("Database initialization complete.")


if __name__ == "__main__":
    save_file = "planar.save"
    if len(sys.argv) == 2:
        save_file = sys.argv[1]
    convert(save_file)